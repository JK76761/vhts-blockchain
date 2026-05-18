// scripts/deploy.js
//
// VHTS deployment script for Hardhat 3 (ESM).
//
// This version avoids any ethers/viem plugin dependency. It deploys through
// Hardhat's built-in JSON-RPC provider and writes frontend/deployment.json so
// the simple web UI can load the latest local addresses automatically.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { network } from "hardhat";
import { keccak256 } from "ethereum-cryptography/keccak.js";
import { bytesToHex, utf8ToBytes } from "ethereum-cryptography/utils.js";

const ARTIFACTS = {
  VehicleRegistry:
    "../artifacts/contracts/VehicleRegistry.sol/VehicleRegistry.json",
  MaintenanceLog:
    "../artifacts/contracts/MaintenanceLog.sol/MaintenanceLog.json",
  AccidentReport:
    "../artifacts/contracts/AccidentReport.sol/AccidentReport.json",
  InspectionRecord:
    "../artifacts/contracts/InspectionRecord.sol/InspectionRecord.json",
};

const ROLE = {
  Manufacturer: 1,
  ServiceCentre: 2,
  Insurer: 3,
  Government: 4,
  Owner: 5,
};

function strip0x(value) {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function pad32(value) {
  return strip0x(value).padStart(64, "0");
}

function encodeAddress(value) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Invalid address: ${value}`);
  }
  return pad32(value.toLowerCase());
}

function encodeUint(value) {
  const number = BigInt(value);
  if (number < 0n) {
    throw new Error(`Invalid unsigned integer: ${value}`);
  }
  return pad32(number.toString(16));
}

function encodeArg(type, value) {
  if (type === "address") return encodeAddress(value);
  if (type === "uint8" || type === "uint16" || type === "uint256") {
    return encodeUint(value);
  }
  throw new Error(`Unsupported deployment ABI type: ${type}`);
}

function getTypes(signature) {
  const start = signature.indexOf("(");
  const end = signature.indexOf(")");
  const types = signature.slice(start + 1, end);
  return types.length === 0 ? [] : types.split(",");
}

function selector(signature) {
  return bytesToHex(keccak256(utf8ToBytes(signature)).slice(0, 4));
}

function encodeCall(signature, args = []) {
  const types = getTypes(signature);
  if (types.length !== args.length) {
    throw new Error(`Argument count mismatch for ${signature}`);
  }
  return `0x${selector(signature)}${types
    .map((type, index) => encodeArg(type, args[index]))
    .join("")}`;
}

function encodeConstructor(bytecode, types = [], args = []) {
  if (types.length !== args.length) {
    throw new Error("Constructor argument count mismatch");
  }
  return `0x${strip0x(bytecode)}${types
    .map((type, index) => encodeArg(type, args[index]))
    .join("")}`;
}

function formatEther(hexWei) {
  const wei = BigInt(hexWei);
  const unit = 10n ** 18n;
  const whole = wei / unit;
  const fraction = (wei % unit).toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${fraction}`;
}

async function loadArtifact(name) {
  const artifactUrl = new URL(ARTIFACTS[name], import.meta.url);
  return JSON.parse(await readFile(artifactUrl, "utf8"));
}

async function waitForReceipt(provider, txHash) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const receipt = await provider.request({
      method: "eth_getTransactionReceipt",
      params: [txHash],
    });

    if (receipt !== null) {
      if (receipt.status !== "0x1") {
        throw new Error(`Transaction failed: ${txHash}`);
      }
      return receipt;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for transaction: ${txHash}`);
}

async function sendTx(provider, from, tx) {
  const txHash = await provider.request({
    method: "eth_sendTransaction",
    params: [{ from, ...tx }],
  });
  return waitForReceipt(provider, txHash);
}

async function main() {
  const connection = await network.create();
  const { provider } = connection;

  try {
    const accounts = await provider.request({
      method: "eth_accounts",
      params: [],
    });

    if (accounts.length === 0) {
      throw new Error("No unlocked accounts available on this network");
    }

    const [
      deployer,
      manufacturer,
      serviceCentre,
      insurer,
      government,
      owner1,
      buyer1,
    ] = accounts;

    const chainIdHex = await provider.request({
      method: "eth_chainId",
      params: [],
    });
    const chainId = Number(BigInt(chainIdHex));

    console.log("\n============================================================");
    console.log("VHTS Deployment");
    console.log("============================================================");
    console.log("Network:           ", connection.networkName);
    console.log("Chain ID:          ", chainId);
    console.log("Deployer (admin):  ", deployer);
    const deployerBal = await provider.request({
      method: "eth_getBalance",
      params: [deployer, "latest"],
    });
    console.log("Deployer balance:  ", formatEther(deployerBal), "ETH");
    console.log();

    async function deployContract(name, constructorTypes = [], constructorArgs = []) {
      console.log(`Deploying ${name}...`);
      const artifact = await loadArtifact(name);
      const data = encodeConstructor(
        artifact.bytecode,
        constructorTypes,
        constructorArgs,
      );
      const receipt = await sendTx(provider, deployer, { data });
      console.log(`  -> ${name}:`, receipt.contractAddress);
      return receipt.contractAddress;
    }

    const registryAddress = await deployContract("VehicleRegistry");
    const maintenanceAddress = await deployContract(
      "MaintenanceLog",
      ["address"],
      [registryAddress],
    );
    const accidentAddress = await deployContract(
      "AccidentReport",
      ["address"],
      [registryAddress],
    );
    const inspectionAddress = await deployContract(
      "InspectionRecord",
      ["address"],
      [registryAddress],
    );

    async function callRegistry(signature, args) {
      await sendTx(provider, deployer, {
        to: registryAddress,
        data: encodeCall(signature, args),
      });
    }

    console.log("\nLinking cross-contract addresses...");
    await callRegistry("linkMaintenanceContract(address)", [
      maintenanceAddress,
    ]);
    console.log("  -> linkMaintenanceContract OK");
    await callRegistry("linkInspectionContract(address)", [inspectionAddress]);
    console.log("  -> linkInspectionContract  OK");

    console.log("\nAssigning stakeholder roles...");
    const assignedActors = {};

    async function assignRole(label, account, role) {
      if (account === undefined) return;
      await callRegistry("assignRole(address,uint8)", [account, role]);
      assignedActors[label] = account;
      console.log(`  -> ${label.padEnd(14)} ${account}`);
    }

    assignedActors.adminGovernment = deployer;
    await assignRole("manufacturer", manufacturer, ROLE.Manufacturer);
    await assignRole("serviceCentre", serviceCentre, ROLE.ServiceCentre);
    await assignRole("insurer", insurer, ROLE.Insurer);
    await assignRole("government", government, ROLE.Government);
    await assignRole("owner1", owner1, ROLE.Owner);
    await assignRole("buyer1", buyer1, ROLE.Owner);

    const deployment = {
      generatedAt: new Date().toISOString(),
      network: connection.networkName,
      chainId,
      contracts: {
        VehicleRegistry: registryAddress,
        MaintenanceLog: maintenanceAddress,
        AccidentReport: accidentAddress,
        InspectionRecord: inspectionAddress,
      },
      actors: assignedActors,
    };

    const frontendDir = new URL("../frontend/", import.meta.url);
    await mkdir(frontendDir, { recursive: true });
    await writeFile(
      new URL("deployment.json", frontendDir),
      `${JSON.stringify(deployment, null, 2)}\n`,
    );

    console.log("\n============================================================");
    console.log("Deployment complete");
    console.log("============================================================");
    console.log("VehicleRegistry:   ", registryAddress);
    console.log("MaintenanceLog:    ", maintenanceAddress);
    console.log("AccidentReport:    ", accidentAddress);
    console.log("InspectionRecord:  ", inspectionAddress);
    console.log();
    console.log("Frontend address file:");
    console.log("  frontend/deployment.json");
    console.log("============================================================\n");

    if (connection.networkName !== "localhost") {
      console.log(
        "Note: run against a persistent Hardhat node for the frontend demo:",
      );
      console.log("  npm run node");
      console.log("  npm run deploy:local");
      console.log("  npm run frontend\n");
    }
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

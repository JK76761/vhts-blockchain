// scripts/deploy.js
//
// Deploys the VHTS contracts to a running local Hardhat JSON-RPC node.
//
// This project intentionally keeps dependencies small, so the script uses
// standard JSON-RPC calls instead of relying on the Hardhat ethers plugin.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256 } from "ethereum-cryptography/keccak.js";
import { bytesToHex, utf8ToBytes } from "ethereum-cryptography/utils.js";

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ROLES = {
  Manufacturer: 1,
  ServiceCentre: 2,
  Insurer: 3,
  Government: 4,
  Owner: 5,
};

function artifactPath(contractName) {
  return path.join(
    ROOT_DIR,
    "artifacts",
    "contracts",
    `${contractName}.sol`,
    `${contractName}.json`,
  );
}

function loadArtifact(contractName) {
  return JSON.parse(fs.readFileSync(artifactPath(contractName), "utf8"));
}

function strip0x(value) {
  return String(value).replace(/^0x/i, "");
}

function encodeAddress(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`Invalid address: ${address}`);
  }

  return strip0x(address).toLowerCase().padStart(64, "0");
}

function encodeUint(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function selector(signature) {
  return bytesToHex(keccak256(utf8ToBytes(signature))).slice(0, 8);
}

function encodeCall(signature, encodedArgs = []) {
  return `0x${selector(signature)}${encodedArgs.join("")}`;
}

function encodeConstructorArgs(encodedArgs = []) {
  return encodedArgs.join("");
}

async function rpc(method, params = []) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC ${method} failed with HTTP ${response.status}`);
  }

  const body = await response.json();
  if (body.error) {
    throw new Error(body.error.message || JSON.stringify(body.error));
  }

  return body.result;
}

async function waitForReceipt(hash) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const receipt = await rpc("eth_getTransactionReceipt", [hash]);
    if (receipt) {
      if (receipt.status !== "0x1") {
        throw new Error(`Transaction reverted: ${hash}`);
      }
      return receipt;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for transaction: ${hash}`);
}

async function sendTransaction(tx) {
  const hash = await rpc("eth_sendTransaction", [tx]);
  return waitForReceipt(hash);
}

async function deployContract(contractName, from, constructorArgs = []) {
  const artifact = loadArtifact(contractName);
  const data = `${artifact.bytecode}${encodeConstructorArgs(constructorArgs)}`;
  const receipt = await sendTransaction({ from, data });
  return receipt.contractAddress;
}

async function callContract(from, to, signature, encodedArgs) {
  return sendTransaction({
    from,
    to,
    data: encodeCall(signature, encodedArgs),
  });
}

function writeDeploymentFile(deployment) {
  const targetPath = path.join(ROOT_DIR, "frontend", "deployment.json");
  fs.writeFileSync(targetPath, `${JSON.stringify(deployment, null, 2)}\n`);
  return targetPath;
}

async function main() {
  const chainId = Number(BigInt(await rpc("eth_chainId")));
  const accounts = await rpc("eth_accounts");
  const [
    deployer,
    manufacturer,
    serviceCentre,
    insurer,
    government,
    owner1,
    buyer1,
  ] = accounts;

  if (!deployer || !buyer1) {
    throw new Error("Hardhat node needs at least seven unlocked accounts");
  }

  console.log("\n============================================================");
  console.log("VHTS Deployment");
  console.log("============================================================");
  console.log("RPC URL:           ", RPC_URL);
  console.log("Chain ID:          ", chainId);
  console.log("Deployer (admin): ", deployer);
  const deployerBal = await rpc("eth_getBalance", [deployer, "latest"]);
  console.log("Deployer balance:  ", `${BigInt(deployerBal) / 10n ** 18n} ETH`);
  console.log();

  console.log("Deploying VehicleRegistry...");
  const registryAddress = await deployContract("VehicleRegistry", deployer);
  console.log("  -> VehicleRegistry:   ", registryAddress);

  console.log("Deploying MaintenanceLog...");
  const maintenanceAddress = await deployContract("MaintenanceLog", deployer, [
    encodeAddress(registryAddress),
  ]);
  console.log("  -> MaintenanceLog:    ", maintenanceAddress);

  console.log("Deploying AccidentReport...");
  const accidentAddress = await deployContract("AccidentReport", deployer, [
    encodeAddress(registryAddress),
  ]);
  console.log("  -> AccidentReport:    ", accidentAddress);

  console.log("Deploying InspectionRecord...");
  const inspectionAddress = await deployContract("InspectionRecord", deployer, [
    encodeAddress(registryAddress),
  ]);
  console.log("  -> InspectionRecord:  ", inspectionAddress);

  console.log("\nLinking cross-contract addresses...");
  await callContract(deployer, registryAddress, "linkMaintenanceContract(address)", [
    encodeAddress(maintenanceAddress),
  ]);
  console.log("  -> linkMaintenanceContract OK");
  await callContract(deployer, registryAddress, "linkInspectionContract(address)", [
    encodeAddress(inspectionAddress),
  ]);
  console.log("  -> linkInspectionContract  OK");

  console.log("\nAssigning stakeholder roles...");
  await callContract(deployer, registryAddress, "assignRole(address,uint8)", [
    encodeAddress(manufacturer),
    encodeUint(ROLES.Manufacturer),
  ]);
  console.log("  -> Manufacturer:  ", manufacturer);
  await callContract(deployer, registryAddress, "assignRole(address,uint8)", [
    encodeAddress(serviceCentre),
    encodeUint(ROLES.ServiceCentre),
  ]);
  console.log("  -> ServiceCentre: ", serviceCentre);
  await callContract(deployer, registryAddress, "assignRole(address,uint8)", [
    encodeAddress(insurer),
    encodeUint(ROLES.Insurer),
  ]);
  console.log("  -> Insurer:       ", insurer);
  await callContract(deployer, registryAddress, "assignRole(address,uint8)", [
    encodeAddress(government),
    encodeUint(ROLES.Government),
  ]);
  console.log("  -> Government:    ", government);
  await callContract(deployer, registryAddress, "assignRole(address,uint8)", [
    encodeAddress(owner1),
    encodeUint(ROLES.Owner),
  ]);
  console.log("  -> Owner1:        ", owner1);
  await callContract(deployer, registryAddress, "assignRole(address,uint8)", [
    encodeAddress(buyer1),
    encodeUint(ROLES.Owner),
  ]);
  console.log("  -> Buyer1:        ", buyer1);

  const deployment = {
    generatedAt: new Date().toISOString(),
    network: "localhost",
    chainId,
    contracts: {
      VehicleRegistry: registryAddress,
      MaintenanceLog: maintenanceAddress,
      AccidentReport: accidentAddress,
      InspectionRecord: inspectionAddress,
    },
    actors: {
      adminGovernment: deployer,
      manufacturer,
      serviceCentre,
      insurer,
      government,
      owner1,
      buyer1,
    },
  };

  const deploymentPath = writeDeploymentFile(deployment);

  console.log("\n============================================================");
  console.log("Deployment complete");
  console.log("============================================================");
  console.log("VehicleRegistry:   ", registryAddress);
  console.log("MaintenanceLog:    ", maintenanceAddress);
  console.log("AccidentReport:    ", accidentAddress);
  console.log("InspectionRecord:  ", inspectionAddress);
  console.log();
  console.log("Stakeholder accounts:");
  console.log("  Admin/Government (default): ", deployer);
  console.log("  Manufacturer:               ", manufacturer);
  console.log("  ServiceCentre:              ", serviceCentre);
  console.log("  Insurer:                    ", insurer);
  console.log("  Government (assigned):      ", government);
  console.log("  Owner1:                     ", owner1);
  console.log("  Buyer1:                     ", buyer1);
  console.log();
  console.log("Frontend deployment file:");
  console.log(" ", path.relative(ROOT_DIR, deploymentPath));
  console.log("============================================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

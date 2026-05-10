// scripts/deploy.js
//
// VHTS deployment script for Hardhat 3 (ESM).
//
// Usage:
//   npx hardhat run scripts/deploy.js
//   npx hardhat run scripts/deploy.js --network sepolia   (if configured)
//
// What this script does:
//   1. Deploys VehicleRegistry first (it has no constructor args).
//   2. Deploys MaintenanceLog, AccidentReport, InspectionRecord, each with
//      the registry's address as constructor arg.
//   3. Calls registry.linkMaintenanceContract() and linkInspectionContract()
//      so transferOwnership can perform its cross-contract checks.
//   4. Assigns roles to the first few signer accounts so the deployment is
//      immediately demo-ready: account[0] is admin/government by default
//      (constructor sets that), and accounts 1..4 become Manufacturer,
//      ServiceCentre, Insurer, Government respectively.
//   5. Prints a clean summary block you can copy into the README.
//
// NOTE on Hardhat 3:
//   Hardhat 3 exposes ethers via `network.connect()`. If your local Hardhat 3
//   environment loads ethers differently, replace the import with whatever
//   your installed Hardhat plugin provides (e.g. viem). The deployment logic
//   below uses only standard ethers v6 API.

import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect();

  const signers = await ethers.getSigners();
  const [
    deployer,
    manufacturer,
    serviceCentre,
    insurer,
    government,
    owner1,
    buyer1,
  ] = signers;

  console.log("\n============================================================");
  console.log("VHTS Deployment");
  console.log("============================================================");
  console.log("Deployer (admin): ", deployer.address);
  const deployerBal = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:  ", ethers.formatEther(deployerBal), "ETH");
  console.log();

  // ---------- 1. VehicleRegistry ----------
  console.log("Deploying VehicleRegistry...");
  const VehicleRegistry = await ethers.getContractFactory("VehicleRegistry");
  const registry = await VehicleRegistry.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("  -> VehicleRegistry:   ", registryAddress);

  // ---------- 2. MaintenanceLog ----------
  console.log("Deploying MaintenanceLog...");
  const MaintenanceLog = await ethers.getContractFactory("MaintenanceLog");
  const maintenance = await MaintenanceLog.deploy(registryAddress);
  await maintenance.waitForDeployment();
  const maintenanceAddress = await maintenance.getAddress();
  console.log("  -> MaintenanceLog:    ", maintenanceAddress);

  // ---------- 3. AccidentReport ----------
  console.log("Deploying AccidentReport...");
  const AccidentReport = await ethers.getContractFactory("AccidentReport");
  const accident = await AccidentReport.deploy(registryAddress);
  await accident.waitForDeployment();
  const accidentAddress = await accident.getAddress();
  console.log("  -> AccidentReport:    ", accidentAddress);

  // ---------- 4. InspectionRecord ----------
  console.log("Deploying InspectionRecord...");
  const InspectionRecord = await ethers.getContractFactory("InspectionRecord");
  const inspection = await InspectionRecord.deploy(registryAddress);
  await inspection.waitForDeployment();
  const inspectionAddress = await inspection.getAddress();
  console.log("  -> InspectionRecord:  ", inspectionAddress);

  // ---------- 5. Wire cross-contract addresses ----------
  console.log("\nLinking cross-contract addresses...");
  await (await registry.linkMaintenanceContract(maintenanceAddress)).wait();
  console.log("  -> linkMaintenanceContract OK");
  await (await registry.linkInspectionContract(inspectionAddress)).wait();
  console.log("  -> linkInspectionContract  OK");

  // ---------- 6. Assign demo roles ----------
  // Role enum: None=0, Manufacturer=1, ServiceCentre=2, Insurer=3,
  //            Government=4, Owner=5
  console.log("\nAssigning stakeholder roles...");
  if (manufacturer) {
    await (await registry.assignRole(manufacturer.address, 1)).wait();
    console.log("  -> Manufacturer:  ", manufacturer.address);
  }
  if (serviceCentre) {
    await (await registry.assignRole(serviceCentre.address, 2)).wait();
    console.log("  -> ServiceCentre: ", serviceCentre.address);
  }
  if (insurer) {
    await (await registry.assignRole(insurer.address, 3)).wait();
    console.log("  -> Insurer:       ", insurer.address);
  }
  if (government) {
    await (await registry.assignRole(government.address, 4)).wait();
    console.log("  -> Government:    ", government.address);
  }
  if (owner1) {
    await (await registry.assignRole(owner1.address, 5)).wait();
    console.log("  -> Owner1:        ", owner1.address);
  }
  if (buyer1) {
    await (await registry.assignRole(buyer1.address, 5)).wait();
    console.log("  -> Buyer1:        ", buyer1.address);
  }

  // ---------- 7. Final summary ----------
  console.log("\n============================================================");
  console.log("Deployment complete");
  console.log("============================================================");
  console.log("VehicleRegistry:   ", registryAddress);
  console.log("MaintenanceLog:    ", maintenanceAddress);
  console.log("AccidentReport:    ", accidentAddress);
  console.log("InspectionRecord:  ", inspectionAddress);
  console.log();
  console.log("Stakeholder accounts (paste into README/demo notes):");
  console.log("  Admin/Government (default): ", deployer.address);
  if (manufacturer)
    console.log("  Manufacturer:               ", manufacturer.address);
  if (serviceCentre)
    console.log("  ServiceCentre:              ", serviceCentre.address);
  if (insurer)
    console.log("  Insurer:                    ", insurer.address);
  if (government)
    console.log("  Government (assigned):      ", government.address);
  if (owner1) console.log("  Owner1:                     ", owner1.address);
  if (buyer1) console.log("  Buyer1:                     ", buyer1.address);
  console.log("============================================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

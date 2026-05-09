// scripts/demo-scenario.js
//
// Runs the full demo scenario against an already-deployed set of contracts.
// Use this for the live demo — it prints each step clearly so the assessor
// can follow along in the terminal.
//
// Workflow:
//   1. Run `npx hardhat run scripts/deploy.js` first.
//   2. Copy the four contract addresses into the constants below.
//   3. Run `npx hardhat run scripts/demo-scenario.js`.

import { network } from "hardhat";

// ===================== EDIT THESE AFTER deploy.js =====================
const REGISTRY_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAINTENANCE_ADDRESS = "0x0000000000000000000000000000000000000000";
const ACCIDENT_ADDRESS = "0x0000000000000000000000000000000000000000";
const INSPECTION_ADDRESS = "0x0000000000000000000000000000000000000000";
// ======================================================================

const VIN = "VIN_DEMO_2026";

function header(title) {
  console.log("\n" + "=".repeat(60));
  console.log(title);
  console.log("=".repeat(60));
}

async function main() {
  if (REGISTRY_ADDRESS === "0x0000000000000000000000000000000000000000") {
    throw new Error(
      "Please paste deployed contract addresses into demo-scenario.js"
    );
  }

  const { ethers } = await network.connect();
  const [
    deployer,
    manufacturer,
    serviceCentre,
    insurer,
    government,
    owner1,
    buyer1,
  ] = await ethers.getSigners();

  // Get contract instances at the deployed addresses
  const registry = await ethers.getContractAt(
    "VehicleRegistry",
    REGISTRY_ADDRESS
  );
  const maintenance = await ethers.getContractAt(
    "MaintenanceLog",
    MAINTENANCE_ADDRESS
  );
  const accident = await ethers.getContractAt(
    "AccidentReport",
    ACCIDENT_ADDRESS
  );
  const inspection = await ethers.getContractAt(
    "InspectionRecord",
    INSPECTION_ADDRESS
  );

  header("ACT 1: Manufacturer registers a brand-new vehicle");
  await (
    await registry
      .connect(manufacturer)
      .registerVehicle(VIN, "Tesla", "Model 3", 2026, owner1.address)
  ).wait();
  console.log(`  Vehicle ${VIN} registered. Initial owner = ${owner1.address}`);

  header("ACT 2: Service centre logs two maintenance events");
  await (
    await maintenance
      .connect(serviceCentre)
      .addServiceRecord(VIN, "PDI", "Pre-delivery inspection", 500)
  ).wait();
  console.log("  Service 1 recorded at 500 km");

  await (
    await maintenance
      .connect(serviceCentre)
      .addServiceRecord(VIN, "Annual", "Oil change", 15000)
  ).wait();
  console.log("  Service 2 recorded at 15,000 km");

  const latestKm = await maintenance.getLatestMileage(VIN);
  console.log(`  Latest recorded mileage: ${latestKm.toString()} km`);

  header("ACT 3: Insurer reports an accident and files a claim");
  // Severity enum: Minor=0, Moderate=1, Major=2, TotalLoss=3
  const reportTx = await accident
    .connect(insurer)
    .reportAccident(VIN, 1, "Rear-end at low speed", 350000);
  const reportReceipt = await reportTx.wait();
  console.log(`  Accident reported (gas used: ${reportReceipt.gasUsed})`);

  await (
    await accident
      .connect(insurer)
      .addInsuranceClaim(VIN, 0, 300000, "approved")
  ).wait();
  console.log("  Claim added: AUD $3,000 approved");

  header("ACT 4: Government performs a passing inspection");
  await (
    await inspection
      .connect(government)
      .addInspection(VIN, 1, "Roadworthy", 365)
  ).wait();
  const valid = await inspection.hasValidInspection(VIN);
  console.log(`  Inspection added. hasValidInspection = ${valid}`);

  header("ACT 5: FRAUDULENT transfer attempt (rolled-back odometer)");
  console.log("  Owner declares 10,000 km — lower than recorded 15,000 km");
  try {
    await (
      await registry
        .connect(owner1)
        .transferOwnership(VIN, buyer1.address, 10000)
    ).wait();
    console.error("  !!! UNEXPECTED: transfer succeeded. This is a bug.");
  } catch (err) {
    console.log("  ✓ Reverted as expected:");
    console.log(
      "    Reason:",
      err.shortMessage || err.reason || err.message.split("\n")[0]
    );
  }

  header("ACT 6: HONEST transfer with valid mileage and inspection");
  await (
    await registry
      .connect(owner1)
      .transferOwnership(VIN, buyer1.address, 16000)
  ).wait();
  const info = await registry.getVehicleInfo(VIN);
  console.log(`  Transfer succeeded. New owner = ${info[4]}`);
  console.log(`  Buyer matches?     ${info[4] === buyer1.address}`);

  header("ACT 7: Buyer queries the full history");
  const services = await maintenance.getServiceHistory(VIN);
  console.log(`  Service records:   ${services.length}`);
  const accidents = await accident.getAccidents(VIN);
  console.log(`  Accident records:  ${accidents.length}`);
  const inspections = await inspection.getInspections(VIN);
  console.log(`  Inspection records:${inspections.length}`);

  console.log("\nDemo complete. The blockchain enforced fraud prevention");
  console.log("automatically through cross-contract verification.\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

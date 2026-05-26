# Vehicle History Tracking System (VHTS)

VHTS is a Solidity and Hardhat project for recording a vehicle's lifecycle history on-chain. It is built around a common used-car problem: buyers often have to trust disconnected records for ownership, servicing, accident history, insurance claims, and roadworthiness inspections.

The project keeps those records in separate smart contracts and lets the registry contract check them before ownership can be transferred.

**IFB452 Blockchain Technology - Final Project, Semester 1 2026**

## Team

| Name | Student number |
| --- | --- |
| Inkwang Lee | n11789077 |
| [Team member name] | [Student number] |

## What the System Does

The system models six stakeholders in a used-car sale:

| Stakeholder | Role in the process |
| --- | --- |
| Manufacturer | Registers a new vehicle |
| Service centre | Adds maintenance records and mileage readings |
| Insurer | Reports accidents and insurance claims |
| Government | Records roadworthiness inspections |
| Owner | Starts an ownership transfer |
| Buyer | Reads the vehicle history before buying |

The main fraud checks happen during `VehicleRegistry.transferOwnership()`. Before a sale is accepted, the registry calls:

- `MaintenanceLog.verifyOdometerConsistent()` to make sure the declared sale mileage is not lower than the latest service mileage.
- `InspectionRecord.hasValidInspection()` to make sure the vehicle has a passing, unexpired inspection.

If either check fails, the ownership transfer reverts.

```text
Owner calls VehicleRegistry.transferOwnership(vin, buyer, declaredMileage)
  |
  |-- MaintenanceLog.verifyOdometerConsistent(vin, declaredMileage)
  |     returns false if the mileage has been rolled back
  |
  |-- InspectionRecord.hasValidInspection(vin)
  |     returns false if there is no current passing inspection
  |
  `-- If both checks pass, VehicleRegistry updates the owner
```

## Contracts

| Contract | Purpose | Write access | Main functions |
| --- | --- | --- | --- |
| `VehicleRegistry` | Vehicle registration, role management, and ownership transfer | Manufacturer, Owner, Admin | `registerVehicle`, `transferOwnership`, `assignRole` |
| `MaintenanceLog` | Service history and odometer consistency | ServiceCentre | `addServiceRecord`, `verifyOdometerConsistent`, `getLatestMileage` |
| `AccidentReport` | Accident reports, insurance claims, and highest severity lookup | Insurer | `reportAccident`, `addInsuranceClaim`, `getHighestSeverityRank` |
| `InspectionRecord` | Roadworthiness inspections and expiry checks | Government | `addInspection`, `hasValidInspection`, `getInspections` |

## Project Structure

```text
vhts-blockchain/
├── contracts/
│   ├── VehicleRegistry.sol
│   ├── MaintenanceLog.sol
│   ├── AccidentReport.sol
│   └── InspectionRecord.sol
├── frontend/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── deployment.example.json
├── scripts/
│   ├── deploy.js
│   └── demo-scenario.js
├── test/
│   ├── MaintenanceLog.t.sol
│   ├── AccidentReport.t.sol
│   ├── InspectionRecord.t.sol
│   └── Integration.t.sol
├── hardhat.config.js
├── package.json
└── README.md
```

## Requirements

- Node.js 20 or newer
- npm

## Install, Compile, and Test

```shell
npm install
npm run compile
npm test
```

The test suite contains 22 Solidity tests covering the main success paths and expected reverts.

## Local Deployment

For a persistent local deployment, keep a Hardhat node running in one terminal:

```shell
npm run node
```

Then deploy the contracts to that local chain from a second terminal:

```shell
npm run deploy:local
```

The deployment script prints the four contract addresses and the demo stakeholder accounts. Keep that output open if you want to run the frontend or the demo script.

## Frontend Demo

The frontend is a static HTML/CSS/JavaScript dashboard in `frontend/`. It connects directly to the local Hardhat JSON-RPC node at `http://127.0.0.1:8545`.

After running `npm run deploy:local`, create a local deployment file:

```shell
cp frontend/deployment.example.json frontend/deployment.json
```

Paste the contract addresses and stakeholder account addresses from the deployment output into `frontend/deployment.json`.

Then start the frontend:

```shell
npm run frontend
```

Open:

```text
http://127.0.0.1:5174
```

The JSON-RPC server is on `http://127.0.0.1:8545`, but that address is for blockchain calls rather than browser viewing.

Suggested demo flow:

1. Select `Manufacturer` and register `VIN_DEMO_2026`.
2. Select `Service Centre` and add a service record.
3. Select `Insurer` and add an accident report and claim.
4. Select `Government` and add a passing inspection.
5. Select `Owner1` and transfer the vehicle to `Buyer1`.
6. Select `Buyer1` and look up the vehicle history.

## Terminal Demo Scenario

The scripted demo follows the same lifecycle:

1. Manufacturer registers a Tesla Model 3 with VIN `VIN_DEMO_2026`.
2. Service centre adds maintenance records at 500 km and 15,000 km.
3. Insurer records a moderate accident and an approved insurance claim.
4. Government adds a passing inspection.
5. Owner tries to sell the vehicle with a declared mileage of 10,000 km.
6. The transfer reverts because the declared mileage is below the latest service mileage.
7. Owner retries with 16,000 km and the transfer succeeds.
8. Buyer reads the full service, accident, claim, and inspection history.

To run it locally, start the Hardhat node in one terminal:

```shell
npm run node
```

Then deploy from another terminal:

```shell
npm run deploy:local
```

Paste the four deployed contract addresses into `scripts/demo-scenario.js`, then run:

```shell
npx hardhat run scripts/demo-scenario.js --network localhost
```

## Design Notes

The contracts are split by responsibility instead of putting every record type into one contract. This keeps access control simple and mirrors the real stakeholders:

- `VehicleRegistry` handles ownership and role assignment.
- `MaintenanceLog` only accepts service-centre writes.
- `AccidentReport` only accepts insurer writes.
- `InspectionRecord` only accepts government writes.

`VehicleRegistry` still coordinates the sale, because the ownership transfer is where the system needs to enforce the cross-contract checks.

`MaintenanceLog` stores `latestMileage` separately from the full service history. That avoids scanning an array every time the registry needs to check a sale mileage.

## Current Limitations

| Limitation | Notes |
| --- | --- |
| Input data still needs trust | The blockchain can preserve records, but it cannot prove that a service centre entered the correct mileage in the first place. |
| Privacy is simplified | This version stores only addresses and vehicle records directly on-chain. A production system would need a clearer off-chain storage and privacy model. |
| Admin can relink contracts | `linkMaintenanceContract` and `linkInspectionContract` can be called again by the admin. In production, these links should probably be locked after setup or controlled by governance. |
| Local demo only | The repository is set up for local Hardhat use. A public testnet deployment would need network configuration and funded deployer keys. |

## License

MIT. See `LICENSE`.

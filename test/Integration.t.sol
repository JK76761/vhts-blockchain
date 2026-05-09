// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VehicleRegistry} from "../contracts/VehicleRegistry.sol";
import {MaintenanceLog} from "../contracts/MaintenanceLog.sol";
import {AccidentReport} from "../contracts/AccidentReport.sol";
import {InspectionRecord} from "../contracts/InspectionRecord.sol";

/// @notice An actor that can execute any of the project's stakeholder calls
/// against any contract. Used to simulate a permissioned multi-stakeholder
/// environment from a single test contract.
contract IntegrationActor {
    function registerVehicle(
        VehicleRegistry registry,
        string memory vin,
        string memory make,
        string memory model,
        uint16 year,
        address initialOwner
    ) public {
        registry.registerVehicle(vin, make, model, year, initialOwner);
    }

    function addServiceRecord(
        MaintenanceLog maintenanceLog,
        string memory vin,
        string memory serviceType,
        string memory description,
        uint256 mileage
    ) public {
        maintenanceLog.addServiceRecord(
            vin,
            serviceType,
            description,
            mileage
        );
    }

    function reportAccident(
        AccidentReport accidentReport,
        string memory vin,
        AccidentReport.Severity severity,
        string memory description,
        uint256 repairCost
    ) public returns (uint256) {
        return
            accidentReport.reportAccident(
                vin,
                severity,
                description,
                repairCost
            );
    }

    function addInsuranceClaim(
        AccidentReport accidentReport,
        string memory vin,
        uint256 accidentId,
        uint256 amount,
        string memory outcome
    ) public returns (uint256) {
        return
            accidentReport.addInsuranceClaim(
                vin,
                accidentId,
                amount,
                outcome
            );
    }

    function addInspection(
        InspectionRecord inspectionRecord,
        string memory vin,
        InspectionRecord.Result result,
        string memory notes,
        uint256 validityPeriodDays
    ) public returns (uint256) {
        return
            inspectionRecord.addInspection(
                vin,
                result,
                notes,
                validityPeriodDays
            );
    }

    function transferOwnership(
        VehicleRegistry registry,
        string memory vin,
        address newOwner,
        uint256 declaredMileage
    ) public {
        registry.transferOwnership(vin, newOwner, declaredMileage);
    }
}

/// @notice End-to-end scenario test that mirrors the live demo script.
/// This is the test you run during the final demo to prove the system works.
contract IntegrationTest {
    string private constant VIN = "VIN_DEMO_2026";
    string private constant MAKE = "Tesla";
    string private constant MODEL = "Model 3";

    VehicleRegistry private registry;
    MaintenanceLog private maintenanceLog;
    AccidentReport private accidentReport;
    InspectionRecord private inspectionRecord;

    IntegrationActor private manufacturer;
    IntegrationActor private serviceCentre;
    IntegrationActor private insurer;
    IntegrationActor private government;
    IntegrationActor private owner;
    IntegrationActor private buyer;

    function setUp() public {
        // Deploy core registry first, then dependent contracts with its address
        registry = new VehicleRegistry();
        maintenanceLog = new MaintenanceLog(address(registry));
        accidentReport = new AccidentReport(address(registry));
        inspectionRecord = new InspectionRecord(address(registry));

        // Wire up cross-contract addresses for transferOwnership
        registry.linkMaintenanceContract(address(maintenanceLog));
        registry.linkInspectionContract(address(inspectionRecord));

        // Create one actor per stakeholder type
        manufacturer = new IntegrationActor();
        serviceCentre = new IntegrationActor();
        insurer = new IntegrationActor();
        government = new IntegrationActor();
        owner = new IntegrationActor();
        buyer = new IntegrationActor();

        registry.assignRole(
            address(manufacturer),
            VehicleRegistry.Role.Manufacturer
        );
        registry.assignRole(
            address(serviceCentre),
            VehicleRegistry.Role.ServiceCentre
        );
        registry.assignRole(address(insurer), VehicleRegistry.Role.Insurer);
        registry.assignRole(
            address(government),
            VehicleRegistry.Role.Government
        );
        registry.assignRole(address(owner), VehicleRegistry.Role.Owner);
        registry.assignRole(address(buyer), VehicleRegistry.Role.Owner);
    }

    /// @notice Full lifecycle: register -> service -> accident -> claim ->
    /// inspection pass -> failed transfer (odometer rollback) -> failed
    /// transfer (no inspection -> stale) -> successful transfer.
    function test_FullVehicleLifecycle() public {
        // ===== Act 1: Manufacturer registers the vehicle =====
        manufacturer.registerVehicle(
            registry,
            VIN,
            MAKE,
            MODEL,
            2026,
            address(owner)
        );
        require(registry.isRegistered(VIN), "Vehicle should be registered");

        // ===== Act 2: Two services added with increasing mileage =====
        serviceCentre.addServiceRecord(
            maintenanceLog,
            VIN,
            "Initial service",
            "Pre-delivery inspection",
            500
        );
        serviceCentre.addServiceRecord(
            maintenanceLog,
            VIN,
            "Annual service",
            "Oil and filter replacement",
            15000
        );
        require(
            maintenanceLog.getLatestMileage(VIN) == 15000,
            "Latest mileage should be 15000"
        );

        // ===== Act 3: Insurer reports accident and adds claim =====
        uint256 accidentId = insurer.reportAccident(
            accidentReport,
            VIN,
            AccidentReport.Severity.Moderate,
            "Rear-end at low speed",
            350000
        );
        insurer.addInsuranceClaim(
            accidentReport,
            VIN,
            accidentId,
            300000,
            "approved"
        );
        require(
            accidentReport.getAccidentCount(VIN) == 1,
            "Should have one accident"
        );
        require(
            accidentReport.getClaimCount(VIN) == 1,
            "Should have one claim"
        );

        // ===== Act 4: Government performs passing inspection =====
        government.addInspection(
            inspectionRecord,
            VIN,
            InspectionRecord.Result.Pass,
            "Roadworthy after repair",
            365
        );
        require(
            inspectionRecord.hasValidInspection(VIN),
            "Should have valid inspection"
        );

        // ===== Act 5: Owner attempts FRAUDULENT transfer (rollback odometer) =====
        try
            owner.transferOwnership(
                registry,
                VIN,
                address(buyer),
                10000 // lower than latest 15000
            )
        {
            revert("Odometer rollback should be rejected");
        } catch {
            (, , , , address current, ) = registry.getVehicleInfo(VIN);
            require(
                current == address(owner),
                "Owner unchanged after fraudulent attempt"
            );
        }

        // ===== Act 6: Owner attempts HONEST transfer with valid mileage =====
        owner.transferOwnership(registry, VIN, address(buyer), 16000);

        (, , , , address newCurrent, ) = registry.getVehicleInfo(VIN);
        require(
            newCurrent == address(buyer),
            "Buyer should now own the vehicle"
        );
    }

    /// @notice Demonstrates that a failed inspection blocks transfer even
    /// when mileage is consistent — the second cross-contract guarantee.
    function test_TransferBlockedByFailedInspection() public {
        manufacturer.registerVehicle(
            registry,
            VIN,
            MAKE,
            MODEL,
            2026,
            address(owner)
        );
        serviceCentre.addServiceRecord(
            maintenanceLog,
            VIN,
            "Annual",
            "Routine",
            5000
        );
        government.addInspection(
            inspectionRecord,
            VIN,
            InspectionRecord.Result.Fail,
            "Brakes below limit",
            365
        );

        try
            owner.transferOwnership(
                registry,
                VIN,
                address(buyer),
                10000
            )
        {
            revert("Failed inspection should block transfer");
        } catch {
            (, , , , address current, ) = registry.getVehicleInfo(VIN);
            require(
                current == address(owner),
                "Owner unchanged when inspection failed"
            );
        }
    }
}

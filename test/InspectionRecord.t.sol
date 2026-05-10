// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {InspectionRecord} from "../contracts/InspectionRecord.sol";
import {VehicleRegistry} from "../contracts/VehicleRegistry.sol";

contract InspectionDemoActor {
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
}

contract InspectionRecordTest {
    string private constant VIN = "VIN555666777";
    string private constant MAKE = "Mazda";
    string private constant MODEL = "CX-5";

    VehicleRegistry private registry;
    InspectionRecord private inspectionRecord;

    InspectionDemoActor private manufacturer;
    InspectionDemoActor private government;
    InspectionDemoActor private owner;
    InspectionDemoActor private unassignedAccount;

    function setUp() public {
        registry = new VehicleRegistry();
        inspectionRecord = new InspectionRecord(address(registry));

        manufacturer = new InspectionDemoActor();
        government = new InspectionDemoActor();
        owner = new InspectionDemoActor();
        unassignedAccount = new InspectionDemoActor();

        registry.assignRole(
            address(manufacturer),
            VehicleRegistry.Role.Manufacturer
        );
        registry.assignRole(
            address(government),
            VehicleRegistry.Role.Government
        );
        registry.assignRole(address(owner), VehicleRegistry.Role.Owner);
    }

    function test_GovernmentCanAddPassingInspection() public {
        _registerVehicle();

        uint256 id = government.addInspection(
            inspectionRecord,
            VIN,
            InspectionRecord.Result.Pass,
            "All systems operational",
            365
        );

        require(id == 0, "First inspection ID should be zero");
        require(
            inspectionRecord.hasValidInspection(VIN),
            "Vehicle should have valid inspection"
        );
        require(
            inspectionRecord.getInspectionCount(VIN) == 1,
            "Inspection count should be one"
        );

        InspectionRecord.Inspection[] memory list = inspectionRecord
            .getInspections(VIN);
        require(list.length == 1, "List length should be one");
        require(
            list[0].inspector == address(government),
            "Inspector should match"
        );
        require(
            uint256(list[0].result) ==
                uint256(InspectionRecord.Result.Pass),
            "Result should be Pass"
        );
    }

    function test_NonGovernmentCannotAddInspection() public {
        _registerVehicle();

        try
            unassignedAccount.addInspection(
                inspectionRecord,
                VIN,
                InspectionRecord.Result.Pass,
                "Unauthorised inspection",
                365
            )
        {
            revert("Unassigned account should not add inspection");
        } catch {
            require(
                !inspectionRecord.hasValidInspection(VIN),
                "Inspection should not be valid"
            );
            require(
                inspectionRecord.getInspectionCount(VIN) == 0,
                "Inspection list should stay empty"
            );
        }
    }

    function test_FailingInspectionIsNotValid() public {
        _registerVehicle();

        government.addInspection(
            inspectionRecord,
            VIN,
            InspectionRecord.Result.Fail,
            "Brake pads worn beyond limit",
            365
        );

        require(
            !inspectionRecord.hasValidInspection(VIN),
            "Failed inspection should not yield validity"
        );
        require(
            inspectionRecord.getInspectionCount(VIN) == 1,
            "Inspection should still be recorded"
        );
    }

    function test_HasValidInspectionFalseWithoutInspection() public {
        _registerVehicle();

        require(
            !inspectionRecord.hasValidInspection(VIN),
            "Without inspection should be invalid"
        );
    }

    function test_LatestInspectionOverridesPrevious() public {
        _registerVehicle();

        // First: Pass
        government.addInspection(
            inspectionRecord,
            VIN,
            InspectionRecord.Result.Pass,
            "Initial check",
            365
        );
        require(
            inspectionRecord.hasValidInspection(VIN),
            "Should be valid after pass"
        );

        // Then: Fail (overrides)
        government.addInspection(
            inspectionRecord,
            VIN,
            InspectionRecord.Result.Fail,
            "Re-inspection found issues",
            365
        );
        require(
            !inspectionRecord.hasValidInspection(VIN),
            "Should be invalid after subsequent failure"
        );

        // Recovery: pass again
        government.addInspection(
            inspectionRecord,
            VIN,
            InspectionRecord.Result.Pass,
            "Issues fixed and re-inspected",
            365
        );
        require(
            inspectionRecord.hasValidInspection(VIN),
            "Should be valid again after passing"
        );
        require(
            inspectionRecord.getInspectionCount(VIN) == 3,
            "All three inspections should be recorded"
        );
    }

    function test_CannotInspectUnregisteredVehicle() public {
        try
            government.addInspection(
                inspectionRecord,
                "UNKNOWN_VIN",
                InspectionRecord.Result.Pass,
                "Phantom inspection",
                365
            )
        {
            revert("Should not inspect unregistered vehicle");
        } catch {
            // Expected revert
        }
    }

    function test_ZeroValidityPeriodIsRejected() public {
        _registerVehicle();

        try
            government.addInspection(
                inspectionRecord,
                VIN,
                InspectionRecord.Result.Pass,
                "Zero days",
                0
            )
        {
            revert("Zero validity period should be rejected");
        } catch {
            require(
                inspectionRecord.getInspectionCount(VIN) == 0,
                "Inspection should not be recorded"
            );
        }
    }

    function _registerVehicle() private {
        manufacturer.registerVehicle(
            registry,
            VIN,
            MAKE,
            MODEL,
            2024,
            address(owner)
        );
    }
}

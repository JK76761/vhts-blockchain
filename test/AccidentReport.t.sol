// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccidentReport} from "../contracts/AccidentReport.sol";
import {VehicleRegistry} from "../contracts/VehicleRegistry.sol";

contract AccidentDemoActor {
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
}

contract AccidentReportTest {
    string private constant VIN = "VIN987654321";
    string private constant MAKE = "Honda";
    string private constant MODEL = "Civic";

    VehicleRegistry private registry;
    AccidentReport private accidentReport;

    AccidentDemoActor private manufacturer;
    AccidentDemoActor private insurer;
    AccidentDemoActor private owner;
    AccidentDemoActor private unassignedAccount;

    function setUp() public {
        registry = new VehicleRegistry();
        accidentReport = new AccidentReport(address(registry));

        manufacturer = new AccidentDemoActor();
        insurer = new AccidentDemoActor();
        owner = new AccidentDemoActor();
        unassignedAccount = new AccidentDemoActor();

        registry.assignRole(
            address(manufacturer),
            VehicleRegistry.Role.Manufacturer
        );
        registry.assignRole(address(insurer), VehicleRegistry.Role.Insurer);
        registry.assignRole(address(owner), VehicleRegistry.Role.Owner);
    }

    function test_InsurerCanReportAccident() public {
        _registerVehicle();

        uint256 accidentId = insurer.reportAccident(
            accidentReport,
            VIN,
            AccidentReport.Severity.Moderate,
            "Rear-end collision at low speed",
            350000 // $3,500.00 in cents
        );

        require(accidentId == 0, "First accident ID should be zero");

        AccidentReport.Accident[] memory list = accidentReport.getAccidents(
            VIN
        );
        require(list.length == 1, "History should contain one accident");
        require(list[0].repairCost == 350000, "Repair cost should match");
        require(list[0].insurer == address(insurer), "Insurer should match");
        require(
            uint256(list[0].severity) ==
                uint256(AccidentReport.Severity.Moderate),
            "Severity should match"
        );
        // Highest severity rank is uint(severity)+1
        require(
            accidentReport.getHighestSeverityRank(VIN) ==
                uint256(AccidentReport.Severity.Moderate) + 1,
            "Highest severity rank should match"
        );
    }

    function test_NonInsurerCannotReportAccident() public {
        _registerVehicle();

        try
            unassignedAccount.reportAccident(
                accidentReport,
                VIN,
                AccidentReport.Severity.Minor,
                "Unauthorised report",
                100000
            )
        {
            revert("Unassigned account should not report accident");
        } catch {
            require(
                accidentReport.getAccidentCount(VIN) == 0,
                "Accident list should stay empty"
            );
        }
    }

    function test_CannotReportOnUnregisteredVehicle() public {
        // Vehicle is NOT registered here
        try
            insurer.reportAccident(
                accidentReport,
                "UNREGISTERED",
                AccidentReport.Severity.Minor,
                "Phantom accident",
                100000
            )
        {
            revert("Should not allow accident on unregistered vehicle");
        } catch {
            // Expected revert from isRegistered check
        }
    }

    function test_InsurerCanAddInsuranceClaim() public {
        _registerVehicle();

        uint256 accidentId = insurer.reportAccident(
            accidentReport,
            VIN,
            AccidentReport.Severity.Major,
            "Side impact collision",
            1200000
        );

        uint256 claimId = insurer.addInsuranceClaim(
            accidentReport,
            VIN,
            accidentId,
            1100000,
            "approved"
        );

        require(claimId == 0, "First claim ID should be zero");

        AccidentReport.InsuranceClaim[] memory list = accidentReport
            .getInsuranceClaims(VIN);
        require(list.length == 1, "Claim list should contain one record");
        require(
            list[0].accidentId == accidentId,
            "Claim should reference correct accident"
        );
        require(list[0].amount == 1100000, "Claim amount should match");
        require(
            keccak256(bytes(list[0].outcome)) ==
                keccak256(bytes("approved")),
            "Outcome should match"
        );
    }

    function test_ClaimRequiresExistingAccident() public {
        _registerVehicle();

        // No accident reported yet, so accidentId 0 doesn't exist for this VIN
        try
            insurer.addInsuranceClaim(
                accidentReport,
                VIN,
                999,
                500000,
                "rejected"
            )
        {
            revert(
                "Should not allow claim without an existing accident for VIN"
            );
        } catch {
            require(
                accidentReport.getClaimCount(VIN) == 0,
                "Claim list should stay empty"
            );
        }
    }

    function test_MultipleAccidentsTrackHighestSeverity() public {
        _registerVehicle();

        insurer.reportAccident(
            accidentReport,
            VIN,
            AccidentReport.Severity.Minor,
            "Parking lot scratch",
            50000
        );
        insurer.reportAccident(
            accidentReport,
            VIN,
            AccidentReport.Severity.Major,
            "Highway collision",
            2500000
        );
        insurer.reportAccident(
            accidentReport,
            VIN,
            AccidentReport.Severity.Moderate,
            "Minor rear-ender afterwards",
            200000
        );

        require(
            accidentReport.getAccidentCount(VIN) == 3,
            "Should have three accidents"
        );
        // Highest severity should remain Major (rank = 3)
        require(
            accidentReport.getHighestSeverityRank(VIN) ==
                uint256(AccidentReport.Severity.Major) + 1,
            "Highest severity rank should be Major"
        );
    }

    function _registerVehicle() private {
        manufacturer.registerVehicle(
            registry,
            VIN,
            MAKE,
            MODEL,
            2023,
            address(owner)
        );
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MaintenanceLog} from "../contracts/MaintenanceLog.sol";
import {InspectionRecord} from "../contracts/InspectionRecord.sol";
import {VehicleRegistry} from "../contracts/VehicleRegistry.sol";

contract DemoActor {
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

contract MaintenanceLogTest {
    string private constant VIN = "VIN123456789";
    string private constant MAKE = "Toyota";
    string private constant MODEL = "Hilux";

    VehicleRegistry private registry;
    MaintenanceLog private maintenanceLog;
    InspectionRecord private inspectionRecord;

    DemoActor private manufacturer;
    DemoActor private serviceCentre;
    DemoActor private government;
    DemoActor private owner;
    DemoActor private newOwner;
    DemoActor private unassignedAccount;

    function setUp() public {
        registry = new VehicleRegistry();
        maintenanceLog = new MaintenanceLog(address(registry));
        inspectionRecord = new InspectionRecord(address(registry));

        manufacturer = new DemoActor();
        serviceCentre = new DemoActor();
        government = new DemoActor();
        owner = new DemoActor();
        newOwner = new DemoActor();
        unassignedAccount = new DemoActor();

        registry.assignRole(
            address(manufacturer),
            VehicleRegistry.Role.Manufacturer
        );
        registry.assignRole(
            address(serviceCentre),
            VehicleRegistry.Role.ServiceCentre
        );
        registry.assignRole(
            address(government),
            VehicleRegistry.Role.Government
        );
        registry.assignRole(address(owner), VehicleRegistry.Role.Owner);
        registry.assignRole(address(newOwner), VehicleRegistry.Role.Owner);

        registry.linkMaintenanceContract(address(maintenanceLog));
        registry.linkInspectionContract(address(inspectionRecord));
    }

    function test_ManufacturerCanRegisterVehicle() public {
        _registerVehicle();

        (
            string memory vehicleVin,
            string memory make,
            string memory model,
            uint16 year,
            address currentOwner,
            bool registered
        ) = registry.getVehicleInfo(VIN);

        require(registry.isRegistered(VIN), "Vehicle should be registered");
        require(registered, "Registered flag should be true");
        require(_sameString(vehicleVin, VIN), "VIN should match");
        require(_sameString(make, MAKE), "Make should match");
        require(_sameString(model, MODEL), "Model should match");
        require(year == 2024, "Year should match");
        require(currentOwner == address(owner), "Owner should match");
    }

    function test_NonManufacturerCannotRegisterVehicle() public {
        try
            unassignedAccount.registerVehicle(
                registry,
                VIN,
                MAKE,
                MODEL,
                2024,
                address(owner)
            )
        {
            revert("Unassigned account should not register vehicle");
        } catch {
            require(!registry.isRegistered(VIN), "Vehicle should not register");
        }
    }

    function test_ServiceCentreCanAddRecordAndLatestMileage() public {
        _registerVehicle();

        serviceCentre.addServiceRecord(
            maintenanceLog,
            VIN,
            "Annual service",
            "Oil change and safety inspection",
            10000
        );

        MaintenanceLog.MaintenanceRecord[] memory history = maintenanceLog
            .getServiceHistory(VIN);

        require(history.length == 1, "History should contain one record");
        require(history[0].recordId == 0, "Record ID should start at zero");
        require(
            _sameString(history[0].serviceType, "Annual service"),
            "Service type should match"
        );
        require(history[0].mileage == 10000, "Mileage should match");
        require(
            history[0].serviceCentre == address(serviceCentre),
            "Service centre should match"
        );
        require(
            maintenanceLog.getLatestMileage(VIN) == 10000,
            "Latest mileage should update"
        );
    }

    function test_NonServiceCentreCannotAddRecord() public {
        _registerVehicle();

        try
            unassignedAccount.addServiceRecord(
                maintenanceLog,
                VIN,
                "Inspection",
                "Unauthorised inspection",
                10000
            )
        {
            revert("Unassigned account should not add service record");
        } catch {
            require(
                maintenanceLog.getServiceHistory(VIN).length == 0,
                "History should stay empty"
            );
        }
    }

    function test_OdometerRejectsLowerMileage() public {
        _registerVehicle();

        serviceCentre.addServiceRecord(
            maintenanceLog,
            VIN,
            "First service",
            "Initial maintenance record",
            10000
        );

        require(
            !maintenanceLog.verifyOdometerConsistent(VIN, 9999),
            "Lower mileage should be inconsistent"
        );

        try
            serviceCentre.addServiceRecord(
                maintenanceLog,
                VIN,
                "Suspicious service",
                "Mileage rollback attempt",
                9999
            )
        {
            revert("Lower mileage should not be accepted");
        } catch {
            require(
                maintenanceLog.getServiceHistory(VIN).length == 1,
                "Invalid record should not be saved"
            );
        }
    }

    function test_TransferOwnershipRequiresConsistentMileage() public {
        _registerVehicle();

        // Add a service record at 10000 km, then a passing inspection
        serviceCentre.addServiceRecord(
            maintenanceLog,
            VIN,
            "First service",
            "Initial maintenance record",
            10000
        );
        government.addInspection(
            inspectionRecord,
            VIN,
            InspectionRecord.Result.Pass,
            "Roadworthy",
            365
        );

        // Lower declared mileage should be blocked even though inspection is valid
        try
            owner.transferOwnership(
                registry,
                VIN,
                address(newOwner),
                9999
            )
        {
            revert(
                "Lower declared mileage should block ownership transfer"
            );
        } catch {
            (, , , , address currentOwner, ) = registry.getVehicleInfo(VIN);
            require(
                currentOwner == address(owner),
                "Owner should not change after failed transfer"
            );
        }

        // Higher declared mileage with valid inspection should succeed
        owner.transferOwnership(registry, VIN, address(newOwner), 12000);

        (, , , , address updatedOwner, ) = registry.getVehicleInfo(VIN);
        require(
            updatedOwner == address(newOwner),
            "Owner should update after valid transfer"
        );
    }

    function test_TransferOwnershipRequiresValidInspection() public {
        _registerVehicle();

        serviceCentre.addServiceRecord(
            maintenanceLog,
            VIN,
            "First service",
            "Initial maintenance record",
            10000
        );

        // No inspection added: transfer should be blocked even with valid mileage
        try
            owner.transferOwnership(
                registry,
                VIN,
                address(newOwner),
                12000
            )
        {
            revert("Transfer without inspection should fail");
        } catch {
            (, , , , address currentOwner, ) = registry.getVehicleInfo(VIN);
            require(
                currentOwner == address(owner),
                "Owner should not change without valid inspection"
            );
        }

        // Add a failing inspection: still should be blocked
        government.addInspection(
            inspectionRecord,
            VIN,
            InspectionRecord.Result.Fail,
            "Brake pads worn",
            365
        );

        try
            owner.transferOwnership(
                registry,
                VIN,
                address(newOwner),
                12000
            )
        {
            revert("Transfer with failed inspection should fail");
        } catch {
            (, , , , address currentOwner, ) = registry.getVehicleInfo(VIN);
            require(
                currentOwner == address(owner),
                "Owner should not change with failed inspection"
            );
        }

        // Pass a fresh inspection: now transfer should succeed
        government.addInspection(
            inspectionRecord,
            VIN,
            InspectionRecord.Result.Pass,
            "Re-inspected and approved",
            365
        );

        owner.transferOwnership(registry, VIN, address(newOwner), 12000);

        (, , , , address updatedOwner, ) = registry.getVehicleInfo(VIN);
        require(
            updatedOwner == address(newOwner),
            "Owner should update after valid transfer"
        );
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

    function _sameString(
        string memory first,
        string memory second
    ) private pure returns (bool) {
        return keccak256(bytes(first)) == keccak256(bytes(second));
    }
}

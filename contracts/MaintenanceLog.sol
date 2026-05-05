// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IVehicleRegistry {
    enum Role {
        None,
        Manufacturer,
        ServiceCentre,
        Insurer,
        Government,
        Owner
    }

    function roles(address account) external view returns (Role);

    function isRegistered(string memory vin) external view returns (bool);
}

contract MaintenanceLog {
    IVehicleRegistry public vehicleRegistry;
    uint256 public nextRecordId;

    struct MaintenanceRecord {
        uint256 recordId;
        string serviceType;
        string description;
        uint256 mileage;
        uint256 timestamp;
        address serviceCentre;
    }

    mapping(string => MaintenanceRecord[]) private serviceHistory;
    mapping(string => uint256) private latestMileage;

    event ServiceRecordAdded(
        string vin,
        uint256 indexed recordId,
        string serviceType,
        uint256 mileage,
        address indexed serviceCentre
    );

    modifier onlyServiceCentre() {
        require(
            vehicleRegistry.roles(msg.sender) ==
                IVehicleRegistry.Role.ServiceCentre,
            "Only service centre can perform this action"
        );
        _;
    }

    constructor(address vehicleRegistryAddress) {
        require(
            vehicleRegistryAddress != address(0),
            "VehicleRegistry address cannot be zero"
        );

        vehicleRegistry = IVehicleRegistry(vehicleRegistryAddress);
    }

    function addServiceRecord(
        string memory vin,
        string memory serviceType,
        string memory description,
        uint256 mileage
    ) public onlyServiceCentre {
        require(bytes(vin).length > 0, "VIN cannot be empty");
        require(bytes(serviceType).length > 0, "Service type cannot be empty");
        require(bytes(description).length > 0, "Description cannot be empty");
        require(vehicleRegistry.isRegistered(vin), "Vehicle is not registered");
        require(
            verifyOdometerConsistent(vin, mileage),
            "Mileage cannot be less than latest mileage"
        );

        uint256 recordId = nextRecordId;
        nextRecordId++;

        serviceHistory[vin].push(
            MaintenanceRecord({
                recordId: recordId,
                serviceType: serviceType,
                description: description,
                mileage: mileage,
                timestamp: block.timestamp,
                serviceCentre: msg.sender
            })
        );

        latestMileage[vin] = mileage;

        emit ServiceRecordAdded(
            vin,
            recordId,
            serviceType,
            mileage,
            msg.sender
        );
    }

    function verifyOdometerConsistent(
        string memory vin,
        uint256 declaredMileage
    ) public view returns (bool) {
        require(bytes(vin).length > 0, "VIN cannot be empty");
        return declaredMileage >= latestMileage[vin];
    }

    function getServiceHistory(
        string memory vin
    ) public view returns (MaintenanceRecord[] memory) {
        require(bytes(vin).length > 0, "VIN cannot be empty");
        require(vehicleRegistry.isRegistered(vin), "Vehicle is not registered");
        return serviceHistory[vin];
    }

    function getLatestMileage(string memory vin) public view returns (uint256) {
        require(bytes(vin).length > 0, "VIN cannot be empty");
        require(vehicleRegistry.isRegistered(vin), "Vehicle is not registered");
        return latestMileage[vin];
    }
}

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

contract InspectionRecord {
    enum Result {
        Fail,
        Pass
    }

    IVehicleRegistry public vehicleRegistry;
    uint256 public nextInspectionId;

    struct Inspection {
        uint256 inspectionId;
        Result result;
        string notes;
        uint256 inspectedAt;
        uint256 expiresAt;
        address inspector;
    }

    mapping(string => Inspection[]) private inspections;
    mapping(string => uint256) private latestExpiresAt;
    mapping(string => Result) private latestResult;
    mapping(string => bool) private inspectionRecorded;

    event InspectionAdded(
        string vin,
        uint256 indexed inspectionId,
        Result result,
        uint256 expiresAt,
        address indexed inspector
    );

    modifier onlyGovernment() {
        require(
            vehicleRegistry.roles(msg.sender) ==
                IVehicleRegistry.Role.Government,
            "Only government can perform this action"
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

    function addInspection(
        string memory vin,
        Result result,
        string memory notes,
        uint256 validityPeriodDays
    ) public onlyGovernment returns (uint256) {
        require(bytes(vin).length > 0, "VIN cannot be empty");
        require(
            validityPeriodDays > 0,
            "Validity period must be greater than zero"
        );
        require(vehicleRegistry.isRegistered(vin), "Vehicle is not registered");

        uint256 inspectionId = nextInspectionId;
        nextInspectionId++;

        uint256 expiresAt = block.timestamp + (validityPeriodDays * 1 days);

        inspections[vin].push(
            Inspection({
                inspectionId: inspectionId,
                result: result,
                notes: notes,
                inspectedAt: block.timestamp,
                expiresAt: expiresAt,
                inspector: msg.sender
            })
        );

        latestExpiresAt[vin] = expiresAt;
        latestResult[vin] = result;
        inspectionRecorded[vin] = true;

        emit InspectionAdded(
            vin,
            inspectionId,
            result,
            expiresAt,
            msg.sender
        );
        return inspectionId;
    }

    /// @notice Cross-contract entry point used by VehicleRegistry.transferOwnership.
    /// Returns true only if the most recent inspection passed AND has not expired.
    function hasValidInspection(
        string memory vin
    ) public view returns (bool) {
        if (!inspectionRecorded[vin]) {
            return false;
        }
        if (latestResult[vin] != Result.Pass) {
            return false;
        }
        return block.timestamp <= latestExpiresAt[vin];
    }

    function getInspections(
        string memory vin
    ) public view returns (Inspection[] memory) {
        require(bytes(vin).length > 0, "VIN cannot be empty");
        require(vehicleRegistry.isRegistered(vin), "Vehicle is not registered");
        return inspections[vin];
    }

    function getLatestExpiresAt(
        string memory vin
    ) public view returns (uint256) {
        require(bytes(vin).length > 0, "VIN cannot be empty");
        return latestExpiresAt[vin];
    }

    function getInspectionCount(
        string memory vin
    ) public view returns (uint256) {
        require(bytes(vin).length > 0, "VIN cannot be empty");
        return inspections[vin].length;
    }
}

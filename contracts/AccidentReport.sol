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

contract AccidentReport {
    enum Severity {
        Minor,
        Moderate,
        Major,
        TotalLoss
    }

    IVehicleRegistry public vehicleRegistry;
    uint256 public nextAccidentId;
    uint256 public nextClaimId;

    struct Accident {
        uint256 accidentId;
        Severity severity;
        string description;
        uint256 repairCost; // stored in cents (e.g. AUD * 100) to avoid decimals
        uint256 timestamp;
        address insurer;
    }

    struct InsuranceClaim {
        uint256 claimId;
        uint256 accidentId;
        uint256 amount; // stored in cents
        string outcome; // "approved", "rejected", "pending"
        uint256 timestamp;
        address insurer;
    }

    mapping(string => Accident[]) private accidents;
    mapping(string => InsuranceClaim[]) private claims;
    mapping(string => uint256) private highestSeverityRank; // 0 = none, 1 = Minor + 1, ...

    event AccidentReported(
        string vin,
        uint256 indexed accidentId,
        Severity severity,
        uint256 repairCost,
        address indexed insurer
    );

    event InsuranceClaimAdded(
        string vin,
        uint256 indexed claimId,
        uint256 indexed accidentId,
        uint256 amount,
        string outcome,
        address indexed insurer
    );

    modifier onlyInsurer() {
        require(
            vehicleRegistry.roles(msg.sender) ==
                IVehicleRegistry.Role.Insurer,
            "Only insurer can perform this action"
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

    function reportAccident(
        string memory vin,
        Severity severity,
        string memory description,
        uint256 repairCost
    ) public onlyInsurer returns (uint256) {
        require(bytes(vin).length > 0, "VIN cannot be empty");
        require(bytes(description).length > 0, "Description cannot be empty");
        require(vehicleRegistry.isRegistered(vin), "Vehicle is not registered");

        uint256 accidentId = nextAccidentId;
        nextAccidentId++;

        accidents[vin].push(
            Accident({
                accidentId: accidentId,
                severity: severity,
                description: description,
                repairCost: repairCost,
                timestamp: block.timestamp,
                insurer: msg.sender
            })
        );

        // Track highest severity ever recorded for quick lookup by buyers
        uint256 severityRank = uint256(severity) + 1;
        if (severityRank > highestSeverityRank[vin]) {
            highestSeverityRank[vin] = severityRank;
        }

        emit AccidentReported(
            vin,
            accidentId,
            severity,
            repairCost,
            msg.sender
        );
        return accidentId;
    }

    function addInsuranceClaim(
        string memory vin,
        uint256 accidentId,
        uint256 amount,
        string memory outcome
    ) public onlyInsurer returns (uint256) {
        require(bytes(vin).length > 0, "VIN cannot be empty");
        require(bytes(outcome).length > 0, "Outcome cannot be empty");
        require(vehicleRegistry.isRegistered(vin), "Vehicle is not registered");
        require(
            _accidentExistsForVin(vin, accidentId),
            "Accident does not exist for this VIN"
        );

        uint256 claimId = nextClaimId;
        nextClaimId++;

        claims[vin].push(
            InsuranceClaim({
                claimId: claimId,
                accidentId: accidentId,
                amount: amount,
                outcome: outcome,
                timestamp: block.timestamp,
                insurer: msg.sender
            })
        );

        emit InsuranceClaimAdded(
            vin,
            claimId,
            accidentId,
            amount,
            outcome,
            msg.sender
        );
        return claimId;
    }

    function getAccidents(
        string memory vin
    ) public view returns (Accident[] memory) {
        require(bytes(vin).length > 0, "VIN cannot be empty");
        require(vehicleRegistry.isRegistered(vin), "Vehicle is not registered");
        return accidents[vin];
    }

    function getInsuranceClaims(
        string memory vin
    ) public view returns (InsuranceClaim[] memory) {
        require(bytes(vin).length > 0, "VIN cannot be empty");
        require(vehicleRegistry.isRegistered(vin), "Vehicle is not registered");
        return claims[vin];
    }

    function getAccidentCount(
        string memory vin
    ) public view returns (uint256) {
        require(bytes(vin).length > 0, "VIN cannot be empty");
        return accidents[vin].length;
    }

    function getClaimCount(string memory vin) public view returns (uint256) {
        require(bytes(vin).length > 0, "VIN cannot be empty");
        return claims[vin].length;
    }

    /// @notice Returns the highest severity ever reported for a vehicle.
    /// Returns 0 if no accidents reported, otherwise (uint256(severity) + 1).
    function getHighestSeverityRank(
        string memory vin
    ) public view returns (uint256) {
        require(bytes(vin).length > 0, "VIN cannot be empty");
        return highestSeverityRank[vin];
    }

    function _accidentExistsForVin(
        string memory vin,
        uint256 accidentId
    ) private view returns (bool) {
        Accident[] storage list = accidents[vin];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i].accidentId == accidentId) {
                return true;
            }
        }
        return false;
    }
}

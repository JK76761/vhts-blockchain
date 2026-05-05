// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMaintenanceLog {
    function verifyOdometerConsistent(
        string memory vin,
        uint256 declaredMileage
    ) external view returns (bool);
}

contract VehicleRegistry {
    address public admin;
    address public maintenanceContract;

    enum Role {
        None,
        Manufacturer,
        ServiceCentre,
        Insurer,
        Government,
        Owner
    }

    struct Vehicle {
        string vin;
        string make;
        string model;
        uint16 year;
        address currentOwner;
        bool registered;
    }

    mapping(address => Role) public roles;
    mapping(string => Vehicle) private vehicles;

    event VehicleRegistered(
        string vin,
        string make,
        string model,
        uint16 year,
        address indexed currentOwner
    );

    event RoleAssigned(address indexed account, Role role);

    event MaintenanceContractLinked(address indexed maintenanceContract);

    event OwnershipTransferred(
        string vin,
        address indexed previousOwner,
        address indexed newOwner,
        uint256 declaredMileage
    );

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can perform this action");
        _;
    }

    modifier onlyManufacturer() {
        require(
            roles[msg.sender] == Role.Manufacturer,
            "Only manufacturer can perform this action"
        );
        _;
    }

    constructor() {
        admin = msg.sender;
        roles[msg.sender] = Role.Government;
        emit RoleAssigned(msg.sender, Role.Government);
    }

    function assignRole(address account, Role role) public onlyAdmin {
        require(account != address(0), "Account cannot be zero address");
        require(role != Role.None, "Role cannot be None");

        roles[account] = role;
        emit RoleAssigned(account, role);
    }

    function linkMaintenanceContract(
        address maintenanceAddress
    ) public onlyAdmin {
        require(
            maintenanceAddress != address(0),
            "Maintenance contract cannot be zero address"
        );

        maintenanceContract = maintenanceAddress;
        emit MaintenanceContractLinked(maintenanceAddress);
    }

    function registerVehicle(
        string memory vin,
        string memory make,
        string memory model,
        uint16 year,
        address initialOwner
    ) public onlyManufacturer {
        require(bytes(vin).length > 0, "VIN cannot be empty");
        require(bytes(make).length > 0, "Make cannot be empty");
        require(bytes(model).length > 0, "Model cannot be empty");
        require(year > 0, "Year must be greater than zero");
        require(initialOwner != address(0), "Owner cannot be zero address");
        require(!vehicles[vin].registered, "Vehicle already registered");

        vehicles[vin] = Vehicle({
            vin: vin,
            make: make,
            model: model,
            year: year,
            currentOwner: initialOwner,
            registered: true
        });

        emit VehicleRegistered(vin, make, model, year, initialOwner);
    }

    function getVehicleInfo(string memory vin)
        public
        view
        returns (
            string memory vehicleVin,
            string memory make,
            string memory model,
            uint16 year,
            address currentOwner,
            bool registered
        )
    {
        require(bytes(vin).length > 0, "VIN cannot be empty");
        require(vehicles[vin].registered, "Vehicle is not registered");

        Vehicle memory vehicle = vehicles[vin];
        return (
            vehicle.vin,
            vehicle.make,
            vehicle.model,
            vehicle.year,
            vehicle.currentOwner,
            vehicle.registered
        );
    }

    function isRegistered(string memory vin) public view returns (bool) {
        require(bytes(vin).length > 0, "VIN cannot be empty");
        return vehicles[vin].registered;
    }

    function transferOwnership(
        string memory vin,
        address newOwner,
        uint256 declaredMileage
    ) public {
        require(bytes(vin).length > 0, "VIN cannot be empty");
        require(vehicles[vin].registered, "Vehicle is not registered");
        require(
            msg.sender == vehicles[vin].currentOwner,
            "Only current owner can transfer ownership"
        );
        require(newOwner != address(0), "New owner cannot be zero address");
        require(
            maintenanceContract != address(0),
            "Maintenance contract is not linked"
        );
        require(
            IMaintenanceLog(maintenanceContract).verifyOdometerConsistent(
                vin,
                declaredMileage
            ),
            "Declared mileage is lower than latest maintenance mileage"
        );

        address previousOwner = vehicles[vin].currentOwner;
        vehicles[vin].currentOwner = newOwner;

        emit OwnershipTransferred(
            vin,
            previousOwner,
            newOwner,
            declaredMileage
        );
    }
}

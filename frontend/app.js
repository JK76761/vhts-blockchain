import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.15.0/+esm";

const LOCAL_RPC_URL = "http://127.0.0.1:8545";
const DEFAULT_VIN = "VIN_DEMO_2026";

const ROLE_NAMES = [
  "None",
  "Manufacturer",
  "ServiceCentre",
  "Insurer",
  "Government",
  "Owner",
];
const SEVERITY_NAMES = ["Minor", "Moderate", "Major", "TotalLoss"];
const RESULT_NAMES = ["Fail", "Pass"];

const ADDRESS_FIELDS = {
  VehicleRegistry: "registryAddress",
  MaintenanceLog: "maintenanceAddress",
  AccidentReport: "accidentAddress",
  InspectionRecord: "inspectionAddress",
};

const ROLE_CONFIG = {
  adminGovernment: {
    label: "Admin / Government",
    actorKey: "adminGovernment",
    target: "VehicleRegistry",
    sections: ["adminActions"],
  },
  manufacturer: {
    label: "Manufacturer",
    actorKey: "manufacturer",
    target: "VehicleRegistry",
    sections: ["manufacturerActions"],
  },
  serviceCentre: {
    label: "Service Centre",
    actorKey: "serviceCentre",
    target: "MaintenanceLog",
    sections: ["serviceActions"],
  },
  insurer: {
    label: "Insurer",
    actorKey: "insurer",
    target: "AccidentReport",
    sections: ["insurerActions"],
  },
  government: {
    label: "Government",
    actorKey: "government",
    target: "InspectionRecord",
    sections: ["governmentActions"],
  },
  owner1: {
    label: "Owner1",
    actorKey: "owner1",
    target: "VehicleRegistry",
    sections: ["ownerActions"],
  },
  buyer1: {
    label: "Buyer1",
    actorKey: "buyer1",
    target: null,
    sections: ["buyerActions"],
  },
};

const ACTOR_OPTIONS = {
  adminGovernment: "Admin / Government",
  manufacturer: "Manufacturer",
  serviceCentre: "Service Centre",
  insurer: "Insurer",
  government: "Government",
  owner1: "Owner1",
  buyer1: "Buyer1",
};

const ABIS = {
  registry: [
    "function assignRole(address account, uint8 role)",
    "function roles(address account) view returns (uint8)",
    "function registerVehicle(string vin, string make, string model, uint16 year, address initialOwner)",
    "function getVehicleInfo(string vin) view returns (string vehicleVin, string make, string model, uint16 year, address currentOwner, bool registered)",
    "function transferOwnership(string vin, address newOwner, uint256 declaredMileage)",
  ],
  maintenance: [
    "function addServiceRecord(string vin, string serviceType, string description, uint256 mileage)",
    "function getServiceHistory(string vin) view returns (tuple(uint256 recordId, string serviceType, string description, uint256 mileage, uint256 timestamp, address serviceCentre)[])",
    "function getLatestMileage(string vin) view returns (uint256)",
  ],
  accident: [
    "function reportAccident(string vin, uint8 severity, string description, uint256 repairCost) returns (uint256)",
    "function addInsuranceClaim(string vin, uint256 accidentId, uint256 amount, string outcome) returns (uint256)",
    "function getAccidents(string vin) view returns (tuple(uint256 accidentId, uint8 severity, string description, uint256 repairCost, uint256 timestamp, address insurer)[])",
    "function getInsuranceClaims(string vin) view returns (tuple(uint256 claimId, uint256 accidentId, uint256 amount, string outcome, uint256 timestamp, address insurer)[])",
    "function getHighestSeverityRank(string vin) view returns (uint256)",
  ],
  inspection: [
    "function addInspection(string vin, uint8 result, string notes, uint256 validityPeriodDays) returns (uint256)",
    "function hasValidInspection(string vin) view returns (bool)",
    "function getInspections(string vin) view returns (tuple(uint256 inspectionId, uint8 result, string notes, uint256 inspectedAt, uint256 expiresAt, address inspector)[])",
  ],
};

const state = {
  provider: null,
  signer: null,
  account: null,
  selectedRole: null,
  deployment: null,
};

const $ = (id) => document.getElementById(id);

function setStatus(message, tone = "") {
  const status = $("statusText");
  status.textContent = message;
  status.className = `status-text ${tone}`.trim();
}

function logActivity(message, tone = "info") {
  const list = $("activityLog");
  const item = document.createElement("li");
  item.className = tone;
  item.innerHTML = `<time>${new Date().toLocaleTimeString()}</time>${escapeHtml(
    message,
  )}`;
  list.prepend(item);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return map[char];
  });
}

function cleanError(error) {
  const message =
    error?.reason ||
    error?.shortMessage ||
    error?.info?.error?.message ||
    error?.data?.message ||
    error?.message ||
    String(error);

  return message
    .replace("execution reverted: ", "")
    .replace(
      "VM Exception while processing transaction: reverted with reason string ",
      "",
    )
    .slice(0, 280);
}

function shortAddress(address) {
  if (!address || !ethers.isAddress(address)) return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function shortHash(hash) {
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-AU").format(Number(value));
}

function formatMoney(cents) {
  const value = BigInt(cents);
  const dollars = value / 100n;
  const remainder = (value % 100n).toString().padStart(2, "0");
  return `AUD ${formatNumber(dollars)}.${remainder}`;
}

function formatDate(seconds) {
  const value = Number(seconds);
  if (value === 0) return "-";
  return new Date(value * 1000).toLocaleString("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function toCents(value) {
  const raw = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    throw new Error("Money values need at most two decimal places");
  }
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function getAddressValues() {
  return Object.fromEntries(
    Object.entries(ADDRESS_FIELDS).map(([name, id]) => [name, $(id).value.trim()]),
  );
}

function setAddressValues(contracts) {
  Object.entries(ADDRESS_FIELDS).forEach(([name, id]) => {
    if (contracts?.[name]) $(id).value = contracts[name];
  });
}

function getActors() {
  return state.deployment?.actors || {};
}

function getRoleAddress(roleKey) {
  const config = ROLE_CONFIG[roleKey];
  return config ? getActors()[config.actorKey] : undefined;
}

function getTargetAddress(targetName) {
  return targetName ? getAddressValues()[targetName] : null;
}

function saveAddressValues() {
  localStorage.setItem("vhts.contracts", JSON.stringify(getAddressValues()));
  setStatus("Addresses saved");
  logActivity("Contract addresses saved locally.", "success");
}

function loadSavedAddresses() {
  const raw = localStorage.getItem("vhts.contracts");
  if (!raw) return false;

  try {
    setAddressValues(JSON.parse(raw));
    return true;
  } catch {
    return false;
  }
}

function populateRoleSelect() {
  const select = $("roleSelect");
  const previousValue = select.value;
  select.innerHTML = "";

  Object.entries(ROLE_CONFIG).forEach(([roleKey, config]) => {
    const address = getRoleAddress(roleKey);
    if (!ethers.isAddress(address)) return;

    const option = document.createElement("option");
    option.value = roleKey;
    option.textContent = `${config.label} (${shortAddress(address)})`;
    select.append(option);
  });

  if (previousValue && [...select.options].some((option) => option.value === previousValue)) {
    select.value = previousValue;
  } else {
    select.value = select.options[0]?.value || "";
  }
}

function populateActorSelects() {
  document.querySelectorAll("[data-actor-select], #roleAccount").forEach((select) => {
    const preferred = select.dataset.actorSelect || select.value;
    select.innerHTML = "";

    Object.entries(ACTOR_OPTIONS).forEach(([actorKey, label]) => {
      const address = getActors()[actorKey];
      if (!ethers.isAddress(address)) return;

      const option = document.createElement("option");
      option.value = address;
      option.textContent = `${label} (${shortAddress(address)})`;
      option.dataset.actorKey = actorKey;
      select.append(option);
    });

    if (preferred) {
      const match = [...select.options].find(
        (option) => option.dataset.actorKey === preferred || option.value === preferred,
      );
      if (match) select.value = match.value;
    }
  });
}

async function loadDeploymentFile(applyAddresses = true) {
  try {
    const response = await fetch(`./deployment.json?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("deployment.json not found");

    state.deployment = await response.json();
    if (applyAddresses) {
      setAddressValues(state.deployment.contracts);
    }
    populateRoleSelect();
    populateActorSelects();
    setStatus("Deployment loaded");
    logActivity("Loaded deployment.json.", "success");
    return state.deployment;
  } catch (error) {
    setStatus("No deployment file", "warning");
    logActivity(cleanError(error), "error");
    return null;
  }
}

async function connectSelectedRole() {
  const roleKey = $("roleSelect").value;
  const config = ROLE_CONFIG[roleKey];
  if (!config) throw new Error("Select a demo role first");

  state.provider = new ethers.JsonRpcProvider(LOCAL_RPC_URL);
  const network = await state.provider.getNetwork();
  if (network.chainId !== 31337n) {
    throw new Error(`Expected local chain 31337, got ${network.chainId}`);
  }

  const accounts = await state.provider.send("eth_accounts", []);
  const desiredAddress = getRoleAddress(roleKey);
  const account = accounts.find(
    (candidate) => candidate.toLowerCase() === desiredAddress?.toLowerCase(),
  );
  if (!account) {
    throw new Error(`Local Hardhat account not found for ${config.label}`);
  }

  state.signer = await state.provider.getSigner(account);
  state.account = await state.signer.getAddress();
  state.selectedRole = roleKey;

  $("networkPill").textContent = `Local chain ${network.chainId.toString()}`;
  $("accountValue").textContent = state.account;
  await refreshAccountRole();
  renderRoleWorkspace();
  setStatus(`${config.label} ready`);
  logActivity(`From ${shortAddress(state.account)} as ${config.label}.`, "success");
}

function renderRoleWorkspace() {
  const config = ROLE_CONFIG[state.selectedRole];
  document.querySelectorAll(".role-actions").forEach((section) => {
    section.classList.remove("active");
  });

  if (!config) {
    $("workspaceTitle").textContent = "Choose a role first";
    $("roleIntro").hidden = false;
    $("primaryToValue").textContent = "-";
    return;
  }

  $("workspaceTitle").textContent = `${config.label} workspace`;
  $("roleIntro").hidden = true;
  const targetAddress = getTargetAddress(config.target);
  $("primaryToValue").textContent = targetAddress
    ? `${config.target}: ${targetAddress}`
    : "Read only";

  config.sections.forEach((id) => {
    $(id)?.classList.add("active");
  });
}

async function refreshAccountRole() {
  if (!state.account) {
    $("roleValue").textContent = "-";
    return;
  }

  const registryAddress = $("registryAddress").value.trim();
  if (!ethers.isAddress(registryAddress)) {
    $("roleValue").textContent = "-";
    return;
  }

  try {
    const registry = new ethers.Contract(
      registryAddress,
      ABIS.registry,
      state.provider,
    );
    const role = Number(await registry.roles(state.account));
    const selectedLabel = ROLE_CONFIG[state.selectedRole]?.label;
    $("roleValue").textContent = selectedLabel
      ? `${selectedLabel} / contract: ${ROLE_NAMES[role] || "Unknown"}`
      : ROLE_NAMES[role] || "Unknown";
  } catch {
    $("roleValue").textContent = ROLE_CONFIG[state.selectedRole]?.label || "-";
  }
}

async function getContracts() {
  if (!state.signer) {
    await connectSelectedRole();
  }

  const addresses = getAddressValues();
  const invalid = Object.entries(addresses).filter(
    ([, value]) => !ethers.isAddress(value),
  );
  if (invalid.length > 0) {
    throw new Error(`Invalid contract address: ${invalid[0][0]}`);
  }

  return {
    registry: new ethers.Contract(
      addresses.VehicleRegistry,
      ABIS.registry,
      state.signer,
    ),
    maintenance: new ethers.Contract(
      addresses.MaintenanceLog,
      ABIS.maintenance,
      state.signer,
    ),
    accident: new ethers.Contract(
      addresses.AccidentReport,
      ABIS.accident,
      state.signer,
    ),
    inspection: new ethers.Contract(
      addresses.InspectionRecord,
      ABIS.inspection,
      state.signer,
    ),
  };
}

async function sendTransaction(label, targetName, transactionPromise) {
  const targetAddress = getTargetAddress(targetName);
  setStatus(`${label} pending`, "warning");
  logActivity(
    `From ${shortAddress(state.account)} to ${targetName} ${shortAddress(targetAddress)}.`,
  );
  const tx = await transactionPromise;
  logActivity(`${label} sent: ${shortHash(tx.hash)}.`);
  const receipt = await tx.wait();
  setStatus(`${label} confirmed`);
  logActivity(`${label} confirmed in block ${receipt.blockNumber}.`, "success");
  return receipt;
}

async function loadVehicle() {
  const vin = $("lookupVin").value.trim();
  if (!vin) throw new Error("VIN is required");

  const { registry, maintenance, accident, inspection } = await getContracts();
  setStatus("Loading vehicle", "warning");

  const vehicle = await registry.getVehicleInfo(vin);
  const [
    vehicleVin,
    make,
    model,
    year,
    currentOwner,
    registered,
  ] = vehicle;

  const [
    latestMileage,
    serviceHistory,
    accidents,
    claims,
    highestSeverityRank,
    inspections,
    validInspection,
  ] = await Promise.all([
    maintenance.getLatestMileage(vin),
    maintenance.getServiceHistory(vin),
    accident.getAccidents(vin),
    accident.getInsuranceClaims(vin),
    accident.getHighestSeverityRank(vin),
    inspection.getInspections(vin),
    inspection.hasValidInspection(vin),
  ]);

  renderVehicle({
    vehicleVin,
    make,
    model,
    year,
    currentOwner,
    registered,
  });
  renderMaintenance(serviceHistory);
  renderAccidents(accidents);
  renderClaims(claims);
  renderInspections(inspections);

  const severityRank = Number(highestSeverityRank);
  $("summaryMileage").textContent = `${formatNumber(latestMileage)} km`;
  $("summaryInspection").textContent = validInspection ? "Valid" : "Not valid";
  $("summarySeverity").textContent =
    severityRank === 0 ? "None" : SEVERITY_NAMES[severityRank - 1];
  $("summaryOwner").textContent = shortAddress(currentOwner);

  setStatus("Vehicle loaded");
  logActivity(`Loaded ${vin}.`, "success");
}

function renderVehicle(vehicle) {
  $("vehicleDetails").classList.remove("empty");
  $("vehicleDetails").innerHTML = `
    <dl>
      <dt>VIN</dt><dd>${escapeHtml(vehicle.vehicleVin)}</dd>
      <dt>Make</dt><dd>${escapeHtml(vehicle.make)}</dd>
      <dt>Model</dt><dd>${escapeHtml(vehicle.model)}</dd>
      <dt>Year</dt><dd>${Number(vehicle.year)}</dd>
      <dt>Owner</dt><dd>${escapeHtml(vehicle.currentOwner)}</dd>
      <dt>Registered</dt><dd>${vehicle.registered ? "Yes" : "No"}</dd>
    </dl>
  `;
}

function renderMaintenance(records) {
  renderRecordList("maintenanceList", records, (record) => `
    <div class="record-title">
      <span>${escapeHtml(record.serviceType)}</span>
      <span>#${record.recordId}</span>
    </div>
    <p>${escapeHtml(record.description)}</p>
    <dl>
      <dt>Mileage</dt><dd>${formatNumber(record.mileage)} km</dd>
      <dt>Date</dt><dd>${formatDate(record.timestamp)}</dd>
      <dt>Centre</dt><dd>${escapeHtml(record.serviceCentre)}</dd>
    </dl>
  `);
}

function renderAccidents(records) {
  renderRecordList("accidentList", records, (record) => `
    <div class="record-title">
      <span>${SEVERITY_NAMES[Number(record.severity)]}</span>
      <span>#${record.accidentId}</span>
    </div>
    <p>${escapeHtml(record.description)}</p>
    <dl>
      <dt>Repair</dt><dd>${formatMoney(record.repairCost)}</dd>
      <dt>Date</dt><dd>${formatDate(record.timestamp)}</dd>
      <dt>Insurer</dt><dd>${escapeHtml(record.insurer)}</dd>
    </dl>
  `);
}

function renderClaims(records) {
  renderRecordList("claimList", records, (record) => `
    <div class="record-title">
      <span>${escapeHtml(record.outcome)}</span>
      <span>#${record.claimId}</span>
    </div>
    <dl>
      <dt>Accident</dt><dd>#${record.accidentId}</dd>
      <dt>Amount</dt><dd>${formatMoney(record.amount)}</dd>
      <dt>Date</dt><dd>${formatDate(record.timestamp)}</dd>
      <dt>Insurer</dt><dd>${escapeHtml(record.insurer)}</dd>
    </dl>
  `);
}

function renderInspections(records) {
  renderRecordList("inspectionList", records, (record) => `
    <div class="record-title">
      <span>${RESULT_NAMES[Number(record.result)]}</span>
      <span>#${record.inspectionId}</span>
    </div>
    <p>${escapeHtml(record.notes || "-")}</p>
    <dl>
      <dt>Inspected</dt><dd>${formatDate(record.inspectedAt)}</dd>
      <dt>Expires</dt><dd>${formatDate(record.expiresAt)}</dd>
      <dt>Inspector</dt><dd>${escapeHtml(record.inspector)}</dd>
    </dl>
  `);
}

function renderRecordList(id, records, render) {
  const target = $(id);
  target.innerHTML = "";

  if (records.length === 0) {
    target.classList.add("empty");
    target.textContent = "No records.";
    return;
  }

  target.classList.remove("empty");
  records.forEach((record) => {
    const item = document.createElement("div");
    item.className = "record";
    item.innerHTML = render(record);
    target.append(item);
  });
}

function setLookupVin(vin) {
  if (vin) $("lookupVin").value = vin;
}

async function handleAction(button, callback) {
  button.disabled = true;
  try {
    await callback();
  } catch (error) {
    const message = cleanError(error);
    setStatus("Action failed", "error");
    logActivity(message, "error");
  } finally {
    button.disabled = false;
  }
}

function bindForm(id, callback) {
  const form = $(id);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    handleAction(button, () => callback(form, formValues(form)));
  });
}

function bindEvents() {
  $("connectRole").addEventListener("click", (event) => {
    handleAction(event.currentTarget, connectSelectedRole);
  });

  $("roleSelect").addEventListener("change", (event) => {
    handleAction(event.currentTarget, connectSelectedRole);
  });

  $("loadDeployment").addEventListener("click", (event) => {
    handleAction(event.currentTarget, async () => {
      await loadDeploymentFile(true);
      await connectSelectedRole();
    });
  });

  $("saveAddresses").addEventListener("click", saveAddressValues);

  $("refreshVehicle").addEventListener("click", (event) => {
    handleAction(event.currentTarget, loadVehicle);
  });

  Object.values(ADDRESS_FIELDS).forEach((id) => {
    $(id).addEventListener("change", () => {
      refreshAccountRole();
      renderRoleWorkspace();
    });
  });

  bindForm("roleForm", async (_form, values) => {
    const { registry } = await getContracts();
    await sendTransaction(
      "Assign role",
      "VehicleRegistry",
      registry.assignRole(values.account.trim(), Number(values.role)),
    );
    await refreshAccountRole();
  });

  bindForm("registerForm", async (_form, values) => {
    const { registry } = await getContracts();
    await sendTransaction(
      "Register vehicle",
      "VehicleRegistry",
      registry.registerVehicle(
        values.vin.trim(),
        values.make.trim(),
        values.model.trim(),
        Number(values.year),
        values.owner.trim(),
      ),
    );
    setLookupVin(values.vin.trim());
    await loadVehicle();
  });

  bindForm("serviceForm", async (_form, values) => {
    const { maintenance } = await getContracts();
    await sendTransaction(
      "Add service",
      "MaintenanceLog",
      maintenance.addServiceRecord(
        values.vin.trim(),
        values.serviceType.trim(),
        values.description.trim(),
        BigInt(values.mileage),
      ),
    );
    setLookupVin(values.vin.trim());
    await loadVehicle();
  });

  bindForm("accidentForm", async (_form, values) => {
    const { accident } = await getContracts();
    await sendTransaction(
      "Report accident",
      "AccidentReport",
      accident.reportAccident(
        values.vin.trim(),
        Number(values.severity),
        values.description.trim(),
        toCents(values.repairCost),
      ),
    );
    setLookupVin(values.vin.trim());
    await loadVehicle();
  });

  bindForm("claimForm", async (_form, values) => {
    const { accident } = await getContracts();
    await sendTransaction(
      "Add claim",
      "AccidentReport",
      accident.addInsuranceClaim(
        values.vin.trim(),
        BigInt(values.accidentId),
        toCents(values.amount),
        values.outcome.trim(),
      ),
    );
    setLookupVin(values.vin.trim());
    await loadVehicle();
  });

  bindForm("inspectionForm", async (_form, values) => {
    const { inspection } = await getContracts();
    await sendTransaction(
      "Add inspection",
      "InspectionRecord",
      inspection.addInspection(
        values.vin.trim(),
        Number(values.result),
        values.notes.trim(),
        BigInt(values.days),
      ),
    );
    setLookupVin(values.vin.trim());
    await loadVehicle();
  });

  bindForm("transferForm", async (_form, values) => {
    const { registry } = await getContracts();
    await sendTransaction(
      "Transfer ownership",
      "VehicleRegistry",
      registry.transferOwnership(
        values.vin.trim(),
        values.newOwner.trim(),
        BigInt(values.mileage),
      ),
    );
    setLookupVin(values.vin.trim());
    await loadVehicle();
  });
}

async function init() {
  bindEvents();
  const hasSavedAddresses = loadSavedAddresses();
  await loadDeploymentFile(!hasSavedAddresses);
  renderRoleWorkspace();

  if ($("roleSelect").value) {
    try {
      await connectSelectedRole();
    } catch (error) {
      setStatus("Local node offline", "warning");
      logActivity(cleanError(error), "error");
    }
  } else {
    setStatus("Ready");
  }
}

init();

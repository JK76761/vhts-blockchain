import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.15.0/+esm";

const ROLE_NAMES = [
  "None",
  "Manufacturer",
  "ServiceCentre",
  "Insurer",
  "Government",
  "Owner",
];
const LOCAL_RPC_URL = "http://127.0.0.1:8545";
const LOCAL_ACTOR_LABELS = {
  adminGovernment: "Admin/Government",
  manufacturer: "Manufacturer",
  serviceCentre: "Service Centre",
  insurer: "Insurer",
  government: "Government",
  owner1: "Owner1",
  buyer1: "Buyer1",
};
const SEVERITY_NAMES = ["Minor", "Moderate", "Major", "TotalLoss"];
const RESULT_NAMES = ["Fail", "Pass"];

const ADDRESS_FIELDS = {
  VehicleRegistry: "registryAddress",
  MaintenanceLog: "maintenanceAddress",
  AccidentReport: "accidentAddress",
  InspectionRecord: "inspectionAddress",
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
  deployment: null,
  mode: null,
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
    .replace("VM Exception while processing transaction: reverted with reason string ", "")
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

function setConnectedAccount(account, mode) {
  state.account = account;
  state.mode = mode;
  $("accountValue").textContent = shortAddress(account);
  $("roleAccount").value = account;
}

function populateLocalAccountSelect() {
  const select = $("localAccountSelect");
  const currentValue = select.value;
  select.innerHTML = '<option value="">Local account</option>';

  const actors = state.deployment?.actors;
  if (!actors) return;

  Object.entries(LOCAL_ACTOR_LABELS).forEach(([key, label]) => {
    const address = actors[key];
    if (!ethers.isAddress(address)) return;

    const option = document.createElement("option");
    option.value = address;
    option.textContent = `${label} ${shortAddress(address)}`;
    select.append(option);
  });

  if (currentValue) {
    select.value = currentValue;
  }
}

function prefillDemoActors() {
  const actors = state.deployment?.actors;
  if (!actors) return;

  const ownerField = $("registerForm")?.elements.namedItem("owner");
  const buyerField = $("transferForm")?.elements.namedItem("newOwner");

  if (ownerField && !ownerField.value && ethers.isAddress(actors.owner1)) {
    ownerField.value = actors.owner1;
  }
  if (buyerField && !buyerField.value && ethers.isAddress(actors.buyer1)) {
    buyerField.value = actors.buyer1;
  }
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
    populateLocalAccountSelect();
    prefillDemoActors();
    setStatus("Deployment loaded");
    logActivity("Loaded frontend/deployment.json.", "success");
    return state.deployment;
  } catch (error) {
    setStatus("No deployment file", "warning");
    logActivity(cleanError(error), "error");
    return null;
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    throw new Error("MetaMask is not available in this browser. Use Local demo.");
  }

  state.provider = new ethers.BrowserProvider(window.ethereum);
  await state.provider.send("eth_requestAccounts", []);
  state.signer = await state.provider.getSigner();
  const account = await state.signer.getAddress();

  setConnectedAccount(account, "wallet");
  await updateNetwork();
  await refreshAccountRole();
  setStatus("MetaMask connected");
  logActivity(`MetaMask connected ${shortAddress(account)}.`, "success");
}

async function connectLocal() {
  state.provider = new ethers.JsonRpcProvider(LOCAL_RPC_URL);
  const network = await state.provider.getNetwork();
  if (network.chainId !== 31337n) {
    throw new Error(`Expected local chain 31337, got ${network.chainId}`);
  }

  const accounts = await state.provider.send("eth_accounts", []);
  if (accounts.length === 0) {
    throw new Error("No unlocked accounts found on the local Hardhat node");
  }

  const selected = $("localAccountSelect").value;
  const preferred =
    selected ||
    state.deployment?.actors?.adminGovernment ||
    state.deployment?.actors?.manufacturer ||
    accounts[0];
  const account = accounts.find(
    (candidate) => candidate.toLowerCase() === preferred.toLowerCase(),
  ) || accounts[0];

  state.signer = await state.provider.getSigner(account);
  setConnectedAccount(await state.signer.getAddress(), "local");
  $("localAccountSelect").value = state.account;
  await updateNetwork();
  await refreshAccountRole();
  setStatus("Local demo connected");
  logActivity(`Local demo connected ${shortAddress(state.account)}.`, "success");
}

async function updateNetwork() {
  if (!state.provider) return;
  const network = await state.provider.getNetwork();
  const mode = state.mode === "local" ? "Local" : "Wallet";
  $("networkPill").textContent = `${mode} chain ${network.chainId.toString()}`;
}

async function switchToLocalChain() {
  if (!window.ethereum) {
    await connectLocal();
    return;
  }

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x7a69" }],
    });
  } catch (error) {
    if (error.code !== 4902) throw error;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: "0x7a69",
          chainName: "Hardhat Localhost",
          nativeCurrency: { name: "Hardhat Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["http://127.0.0.1:8545"],
        },
      ],
    });
  }

  await updateNetwork();
  setStatus("Local chain selected");
}

async function getContracts() {
  if (!state.signer) {
    await connectLocal();
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

async function refreshAccountRole() {
  if (!state.account) return;

  const registryAddress = $("registryAddress").value.trim();
  if (!ethers.isAddress(registryAddress)) {
    $("roleValue").textContent = "-";
    return;
  }

  try {
    const registry = new ethers.Contract(
      registryAddress,
      ABIS.registry,
      state.signer || state.provider,
    );
    const role = Number(await registry.roles(state.account));
    $("roleValue").textContent = ROLE_NAMES[role] || "Unknown";
  } catch {
    $("roleValue").textContent = "-";
  }
}

async function sendTransaction(label, transactionPromise) {
  setStatus(`${label} pending`, "warning");
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

function resolveField(target) {
  if (target.includes(".")) {
    const [formId, name] = target.split(".");
    return $(formId)?.elements.namedItem(name);
  }
  return $(target);
}

function bindFillButtons() {
  document.querySelectorAll("[data-fill-connected]").forEach((button) => {
    button.addEventListener("click", async () => {
      await handleAction(button, async () => {
        if (!state.account) await connectLocal();
        const field = resolveField(button.dataset.fillConnected);
        if (field) field.value = state.account;
      });
    });
  });

  document.querySelectorAll("[data-fill-actor]").forEach((button) => {
    button.addEventListener("click", () => {
      const actor = state.deployment?.actors?.[button.dataset.fillActor];
      const field = resolveField(button.dataset.target);
      if (actor && field) {
        field.value = actor;
      } else {
        setStatus("Actor not found", "warning");
      }
    });
  });
}

function bindEvents() {
  $("connectLocal").addEventListener("click", (event) => {
    handleAction(event.currentTarget, connectLocal);
  });

  $("connectWallet").addEventListener("click", (event) => {
    handleAction(event.currentTarget, connectWallet);
  });

  $("localAccountSelect").addEventListener("change", (event) => {
    if (event.currentTarget.value === "") return;
    handleAction(event.currentTarget, connectLocal);
  });

  $("loadDeployment").addEventListener("click", (event) => {
    handleAction(event.currentTarget, async () => {
      await loadDeploymentFile(true);
      await refreshAccountRole();
    });
  });

  $("saveAddresses").addEventListener("click", saveAddressValues);

  $("switchLocal").addEventListener("click", (event) => {
    handleAction(event.currentTarget, switchToLocalChain);
  });

  $("refreshVehicle").addEventListener("click", (event) => {
    handleAction(event.currentTarget, loadVehicle);
  });

  Object.values(ADDRESS_FIELDS).forEach((id) => {
    $(id).addEventListener("change", refreshAccountRole);
  });

  bindFillButtons();

  bindForm("roleForm", async (_form, values) => {
    const { registry } = await getContracts();
    await sendTransaction(
      "Assign role",
      registry.assignRole(values.account.trim(), Number(values.role)),
    );
    await refreshAccountRole();
  });

  bindForm("registerForm", async (_form, values) => {
    const { registry } = await getContracts();
    const owner =
      values.owner.trim() || state.deployment?.actors?.owner1 || state.account;
    await sendTransaction(
      "Register vehicle",
      registry.registerVehicle(
        values.vin.trim(),
        values.make.trim(),
        values.model.trim(),
        Number(values.year),
        owner,
      ),
    );
    setLookupVin(values.vin.trim());
    await loadVehicle();
  });

  bindForm("serviceForm", async (_form, values) => {
    const { maintenance } = await getContracts();
    await sendTransaction(
      "Add service",
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
      registry.transferOwnership(
        values.vin.trim(),
        values.newOwner.trim(),
        BigInt(values.mileage),
      ),
    );
    setLookupVin(values.vin.trim());
    await loadVehicle();
  });

  if (window.ethereum) {
    window.ethereum.on("accountsChanged", () => {
      if (state.mode === "local") return;
      state.account = null;
      connectWallet().catch((error) => {
        setStatus("Wallet disconnected", "warning");
        logActivity(cleanError(error), "error");
      });
    });
    window.ethereum.on("chainChanged", () => {
      if (state.mode === "local") return;
      updateNetwork().catch(() => {});
    });
  }
}

async function init() {
  bindEvents();
  const hasSavedAddresses = loadSavedAddresses();
  await loadDeploymentFile(!hasSavedAddresses);
  setStatus("Ready");
}

init();

import { createServer } from "node:http";
import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const dataDir = path.join(root, "data");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const maxBodyBytes = 64 * 1024;
let writeQueue = Promise.resolve();

const statusOptions = {
  request: new Set(["new", "contacted", "quoted", "booked", "completed", "lost"]),
  cleaner: new Set(["new", "contacted", "screening", "approved", "paused", "rejected"])
};

const cleanerServiceFields = {
  serviceTurnovers: "Rental turnovers",
  serviceEndOfTenancy: "End-of-tenancy",
  serviceWorkplaces: "Offices and workplaces",
  serviceCommunal: "Communal areas",
  serviceDeepCleans: "Deep cleans"
};

const requestServiceMap = {
  "Rental turnover clean": "Rental turnovers",
  "End-of-tenancy clean": "End-of-tenancy",
  "Regular workplace clean": "Offices and workplaces",
  "Communal area clean": "Communal areas",
  "One-off deep clean": "Deep cleans"
};

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

function setSecurityHeaders(response) {
  response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function json(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) throw Object.assign(new Error("Request is too large."), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Invalid request."), { statusCode: 400 });
  }
}

function text(value, max = 300) {
  return typeof value === "string" ? value.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, max) : "";
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isUkPostcode(value) {
  return /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(value);
}

function isPhone(value) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function ensureSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  const expected = new URL(`http://${request.headers.host}`).origin;
  const forwardedProto = request.headers["x-forwarded-proto"];
  const deployedExpected = forwardedProto ? new URL(`${forwardedProto}://${request.headers.host}`).origin : expected;
  if (origin !== expected && origin !== deployedExpected) {
    throw Object.assign(new Error("Cross-site submission blocked."), { statusCode: 403 });
  }
}

async function saveRecord(filename, record) {
  const operation = writeQueue.catch(() => {}).then(async () => {
    await mkdir(dataDir, { recursive: true });
    await appendFile(path.join(dataDir, filename), `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  });
  writeQueue = operation;
  return operation;
}

async function readRecords(filename) {
  try {
    const contents = await readFile(path.join(dataDir, filename), "utf8");
    return contents.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function readJsonFile(filename, fallback = {}) {
  try {
    return JSON.parse(await readFile(path.join(dataDir, filename), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function saveJsonFile(filename, value) {
  const operation = writeQueue.catch(() => {}).then(async () => {
    await mkdir(dataDir, { recursive: true });
    const target = path.join(dataDir, filename);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  });
  writeQueue = operation;
  return operation;
}

function launchReadiness(config) {
  const checks = {
    identity: Boolean(config.legalOwnerName && config.businessStructure && config.legalBusinessName && config.tradingAddress),
    contact: Boolean(config.supportEmail && isEmail(config.supportEmail) && config.supportPhone && isPhone(config.supportPhone)),
    pilotArea: Boolean(config.pilotPostcodes),
    economics: Boolean(config.customerHourlyRate > 0 && config.cleanerHourlyPay > 0 && config.minimumHours > 0 && config.customerHourlyRate > config.cleanerHourlyPay),
    insurance: config.insuranceStatus === "active",
    operatingRules: Boolean(config.cleanerModel && config.cancellationPolicy && config.paymentTiming)
  };
  return { checks, completed: Object.values(checks).filter(Boolean).length, total: Object.keys(checks).length, ready: Object.values(checks).every(Boolean) };
}

function isAdminAuthorised(request) {
  const remoteAddress = request.socket.remoteAddress || "";
  const isLoopbackAddress = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
  let requestHostname = "";
  try {
    requestHostname = new URL(`http://${request.headers.host || ""}`).hostname;
  } catch {}
  const isLocalHostname = requestHostname === "127.0.0.1" || requestHostname === "localhost" || requestHostname === "[::1]";
  const hasProxyHeaders = Boolean(request.headers["x-forwarded-for"] || request.headers["x-forwarded-host"]);
  const serverIsLocalOnly = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (serverIsLocalOnly && isLoopbackAddress && isLocalHostname && !hasProxyHeaders) return true;
  const adminKey = process.env.ADMIN_KEY;
  return Boolean(adminKey && request.headers["x-admin-key"] === adminKey);
}

async function getAdminRecords(request, response) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  const [requests, cleaners, updates, activities, proposals, proposalUpdates] = await Promise.all([
    readRecords("cleaning-requests.ndjson"),
    readRecords("cleaner-applications.ndjson"),
    readRecords("status-updates.ndjson"),
    readRecords("lead-activity.ndjson"),
    readRecords("match-proposals.ndjson"),
    readRecords("proposal-status.ndjson")
  ]);
  const latestStatuses = new Map();
  for (const update of updates) latestStatuses.set(update.id, update.status);
  const activitiesById = new Map();
  for (const activity of activities) {
    const list = activitiesById.get(activity.id) || [];
    list.push(activity);
    activitiesById.set(activity.id, list);
  }
  const proposalsByRequest = new Map();
  const latestProposalStatuses = new Map();
  for (const update of proposalUpdates) latestProposalStatuses.set(update.proposalId, update.status);
  for (const proposal of proposals) {
    const list = proposalsByRequest.get(proposal.requestId) || [];
    list.push({ ...proposal, status: latestProposalStatuses.get(proposal.id) || proposal.status || "draft" });
    proposalsByRequest.set(proposal.requestId, list);
  }
  const merge = (record, kind) => {
    const leadActivities = (activitiesById.get(record.id) || []).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const leadProposals = (proposalsByRequest.get(record.id) || []).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return { ...record, kind, status: latestStatuses.get(record.id) || record.status || "new", activities: leadActivities.slice(0, 10), nextActionAt: leadActivities.find((activity) => activity.nextActionAt)?.nextActionAt || "", proposals: leadProposals.slice(0, 5) };
  };
  const records = [
    ...requests.map((record) => merge(record, "request")),
    ...cleaners.map((record) => merge(record, "cleaner"))
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return json(response, 200, { ok: true, records });
}

async function updateAdminProposalStatus(request, response) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  ensureSameOrigin(request);
  const input = await readJson(request);
  const proposalId = text(input.proposalId, 40);
  const status = text(input.status, 30);
  const transitions = {
    draft: new Set(["ready", "cancelled"]),
    ready: new Set(["draft", "sent", "cancelled"]),
    sent: new Set(["accepted", "declined", "cancelled"]),
    accepted: new Set([]),
    declined: new Set([]),
    cancelled: new Set([])
  };
  const [proposals, updates, config] = await Promise.all([
    readRecords("match-proposals.ndjson"),
    readRecords("proposal-status.ndjson"),
    readJsonFile("business-config.json", {})
  ]);
  const proposal = proposals.find((record) => record.id === proposalId);
  if (!proposal) return json(response, 404, { ok: false, error: "Proposal not found." });
  let currentStatus = proposal.status || "draft";
  for (const update of updates) if (update.proposalId === proposalId) currentStatus = update.status;
  if (!transitions[currentStatus]?.has(status)) return json(response, 422, { ok: false, error: `Proposal cannot move from ${currentStatus} to ${status}.` });
  if (["ready", "sent", "accepted"].includes(status) && !launchReadiness(config).ready) {
    return json(response, 422, { ok: false, error: "Complete all six launch-readiness checks before advancing this proposal." });
  }
  const update = { proposalId, requestId: proposal.requestId, status, previousStatus: currentStatus, updatedAt: new Date().toISOString() };
  await saveRecord("proposal-status.ndjson", update);
  return json(response, 200, { ok: true, proposalId, status });
}

async function createAdminProposal(request, response) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  ensureSameOrigin(request);
  const input = await readJson(request);
  const requestId = text(input.requestId, 40);
  const cleanerId = text(input.cleanerId, 40);
  const proposedDate = text(input.proposedDate, 20);
  const estimatedHours = Math.max(0, Number(input.estimatedHours) || 0);
  const customerRate = Math.max(0, Number(input.customerRate) || 0);
  const cleanerRate = Math.max(0, Number(input.cleanerRate) || 0);
  const otherCosts = Math.max(0, Number(input.otherCosts) || 0);
  const note = text(input.note, 1000);

  const errors = [];
  if (!requestId || !cleanerId) errors.push("Customer request and cleaner are required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(proposedDate)) errors.push("Choose a proposed date.");
  if (estimatedHours <= 0 || customerRate <= 0 || cleanerRate <= 0) errors.push("Hours, customer rate and cleaner pay must be greater than zero.");
  if (errors.length) return json(response, 422, { ok: false, errors });

  const [requests, cleaners, updates] = await Promise.all([
    readRecords("cleaning-requests.ndjson"),
    readRecords("cleaner-applications.ndjson"),
    readRecords("status-updates.ndjson")
  ]);
  const customerRequest = requests.find((record) => record.id === requestId);
  const cleaner = cleaners.find((record) => record.id === cleanerId);
  const latestStatuses = new Map();
  for (const update of updates) latestStatuses.set(update.id, update.status);
  if (!customerRequest || !cleaner) return json(response, 404, { ok: false, error: "Customer request or cleaner was not found." });
  if ((latestStatuses.get(cleaner.id) || cleaner.status) !== "approved") return json(response, 422, { ok: false, error: "Only an approved cleaner can be proposed." });
  const requiredService = requestServiceMap[customerRequest.service] || "";
  if (requiredService && !cleaner.services?.includes(requiredService)) return json(response, 422, { ok: false, error: "Cleaner is not approved for the requested service." });

  const customerTotal = estimatedHours * customerRate;
  const cleanerPay = estimatedHours * cleanerRate;
  const contribution = customerTotal - cleanerPay - otherCosts;
  if (contribution <= 0) return json(response, 422, { ok: false, error: "This proposal loses money before overheads. Change the price, pay or scope." });
  const marginPercent = (contribution / customerTotal) * 100;
  const proposal = {
    id: `PRO-${randomUUID().slice(0, 8).toUpperCase()}`,
    requestId,
    cleanerId,
    cleanerName: cleaner.fullName,
    proposedDate,
    estimatedHours,
    customerRate,
    cleanerRate,
    otherCosts,
    customerTotal,
    cleanerPay,
    contribution,
    marginPercent,
    note,
    status: "draft",
    createdAt: new Date().toISOString()
  };
  await saveRecord("match-proposals.ndjson", proposal);
  return json(response, 201, { ok: true, proposal });
}

async function getAdminMatches(request, response, requestId) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  const [requests, cleaners, updates] = await Promise.all([
    readRecords("cleaning-requests.ndjson"),
    readRecords("cleaner-applications.ndjson"),
    readRecords("status-updates.ndjson")
  ]);
  const customerRequest = requests.find((record) => record.id === requestId);
  if (!customerRequest) return json(response, 404, { ok: false, error: "Customer request not found." });

  const latestStatuses = new Map();
  for (const update of updates) latestStatuses.set(update.id, update.status);
  const requiredService = requestServiceMap[customerRequest.service] || "";
  const outwardCode = customerRequest.postcode.replace(/\s+/g, " ").split(" ")[0].toUpperCase();
  const postcodeArea = outwardCode.match(/^[A-Z]+/)?.[0] || "";

  const matches = cleaners
    .filter((cleaner) => (latestStatuses.get(cleaner.id) || cleaner.status) === "approved")
    .map((cleaner) => {
      const services = Array.isArray(cleaner.services) ? cleaner.services : [];
      const serviceMatch = !requiredService || services.includes(requiredService);
      const coverageText = cleaner.travelAreas.toUpperCase();
      const exactCoverage = Boolean(outwardCode && coverageText.includes(outwardCode));
      const areaCoverage = Boolean(postcodeArea && new RegExp(`(^|[^A-Z])${postcodeArea}([^A-Z]|$)`).test(coverageText));
      const coverageScore = exactCoverage ? 60 : areaCoverage ? 35 : 0;
      const serviceScore = serviceMatch ? 30 : 0;
      const score = 10 + coverageScore + serviceScore;
      return {
        id: cleaner.id,
        fullName: cleaner.fullName,
        email: cleaner.email,
        phone: cleaner.phone,
        postcode: cleaner.postcode,
        travelAreas: cleaner.travelAreas,
        availability: cleaner.availability,
        experience: cleaner.experience,
        services,
        serviceMatch,
        coverage: exactCoverage ? "Postcode listed" : areaCoverage ? "Postcode area listed" : "Coverage needs checking",
        score
      };
    })
    .filter((cleaner) => cleaner.serviceMatch)
    .sort((left, right) => right.score - left.score || left.fullName.localeCompare(right.fullName))
    .slice(0, 10);

  return json(response, 200, { ok: true, request: { id: customerRequest.id, postcode: customerRequest.postcode, service: customerRequest.service }, matches });
}

async function addAdminActivity(request, response) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  ensureSameOrigin(request);
  const input = await readJson(request);
  const id = text(input.id, 40);
  const kind = text(input.kind, 20);
  const note = text(input.note, 1000);
  const nextActionAt = text(input.nextActionAt, 20);
  if (!id || !["request", "cleaner"].includes(kind) || (!note && !nextActionAt)) return json(response, 422, { ok: false, error: "Add a note or next-action date." });
  if (nextActionAt && !/^\d{4}-\d{2}-\d{2}$/.test(nextActionAt)) return json(response, 422, { ok: false, error: "Invalid next-action date." });

  const source = kind === "request" ? "cleaning-requests.ndjson" : "cleaner-applications.ndjson";
  const records = await readRecords(source);
  if (!records.some((record) => record.id === id)) return json(response, 404, { ok: false, error: "Record not found." });

  const activity = { activityId: `ACT-${randomUUID().slice(0, 8).toUpperCase()}`, id, kind, note, nextActionAt, createdAt: new Date().toISOString() };
  await saveRecord("lead-activity.ndjson", activity);
  return json(response, 201, { ok: true, activity });
}

async function getAdminConfig(request, response) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  const config = await readJsonFile("business-config.json", {});
  return json(response, 200, { ok: true, config, readiness: launchReadiness(config) });
}

async function updateAdminConfig(request, response) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  ensureSameOrigin(request);
  const input = await readJson(request);
  const config = {
    legalOwnerName: text(input.legalOwnerName, 160),
    businessStructure: text(input.businessStructure, 80),
    legalBusinessName: text(input.legalBusinessName, 180),
    tradingAddress: text(input.tradingAddress, 400),
    supportEmail: text(input.supportEmail, 160).toLowerCase(),
    supportPhone: text(input.supportPhone, 40),
    pilotPostcodes: text(input.pilotPostcodes, 400).toUpperCase(),
    cleanerModel: text(input.cleanerModel, 80),
    insuranceStatus: text(input.insuranceStatus, 40),
    customerHourlyRate: Math.max(0, Number(input.customerHourlyRate) || 0),
    cleanerHourlyPay: Math.max(0, Number(input.cleanerHourlyPay) || 0),
    minimumHours: Math.max(0, Number(input.minimumHours) || 0),
    cancellationPolicy: text(input.cancellationPolicy, 1000),
    paymentTiming: text(input.paymentTiming, 100),
    updatedAt: new Date().toISOString()
  };
  const errors = [];
  if (config.supportEmail && !isEmail(config.supportEmail)) errors.push("Enter a valid support email.");
  if (config.supportPhone && !isPhone(config.supportPhone)) errors.push("Enter a valid support phone number.");
  if (config.customerHourlyRate > 0 && config.cleanerHourlyPay > 0 && config.customerHourlyRate <= config.cleanerHourlyPay) errors.push("Customer rate must be higher than cleaner pay before other costs.");
  if (errors.length) return json(response, 422, { ok: false, errors });
  await saveJsonFile("business-config.json", config);
  return json(response, 200, { ok: true, config, readiness: launchReadiness(config) });
}

async function updateAdminStatus(request, response) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  ensureSameOrigin(request);
  const input = await readJson(request);
  const id = text(input.id, 40);
  const kind = text(input.kind, 20);
  const status = text(input.status, 30);
  if (!id || !statusOptions[kind]?.has(status)) return json(response, 422, { ok: false, error: "Invalid status update." });

  const source = kind === "request" ? "cleaning-requests.ndjson" : "cleaner-applications.ndjson";
  const records = await readRecords(source);
  if (!records.some((record) => record.id === id)) return json(response, 404, { ok: false, error: "Record not found." });

  await saveRecord("status-updates.ndjson", { id, kind, status, updatedAt: new Date().toISOString() });
  return json(response, 200, { ok: true, id, status });
}

function required(value, label, errors) {
  if (!value) errors.push(`${label} is required.`);
}

async function handleCleaningRequest(request, response) {
  ensureSameOrigin(request);
  const input = await readJson(request);

  if (text(input.website, 120)) return json(response, 201, { ok: true, reference: "received" });

  const record = {
    id: `REQ-${randomUUID().slice(0, 8).toUpperCase()}`,
    createdAt: new Date().toISOString(),
    status: "new",
    contactName: text(input.contactName, 120),
    organisation: text(input.organisation, 160),
    email: text(input.email, 160).toLowerCase(),
    phone: text(input.phone, 40),
    postcode: text(input.postcode, 12).toUpperCase(),
    customerType: text(input.customerType, 40),
    propertyType: text(input.propertyType, 80),
    service: text(input.service, 80),
    frequency: text(input.frequency, 80),
    preferredDate: text(input.preferredDate, 20),
    details: text(input.details, 1200),
    consent: input.consent === true
  };

  const errors = [];
  required(record.contactName, "Contact name", errors);
  required(record.email, "Email", errors);
  required(record.phone, "Phone", errors);
  required(record.postcode, "Postcode", errors);
  required(record.customerType, "Customer type", errors);
  required(record.propertyType, "Property type", errors);
  required(record.service, "Service", errors);
  if (record.email && !isEmail(record.email)) errors.push("Enter a valid email address.");
  if (record.phone && !isPhone(record.phone)) errors.push("Enter a valid phone number.");
  if (record.postcode && !isUkPostcode(record.postcode)) errors.push("Enter a valid UK postcode.");
  if (!record.consent) errors.push("Privacy consent is required.");
  if (errors.length) return json(response, 422, { ok: false, errors });

  await saveRecord("cleaning-requests.ndjson", record);
  return json(response, 201, { ok: true, reference: record.id });
}

async function handleCleanerApplication(request, response) {
  ensureSameOrigin(request);
  const input = await readJson(request);

  if (text(input.website, 120)) return json(response, 201, { ok: true, reference: "received" });

  const record = {
    id: `CLN-${randomUUID().slice(0, 8).toUpperCase()}`,
    createdAt: new Date().toISOString(),
    status: "new",
    fullName: text(input.fullName, 120),
    email: text(input.email, 160).toLowerCase(),
    phone: text(input.phone, 40),
    postcode: text(input.postcode, 12).toUpperCase(),
    travelAreas: text(input.travelAreas, 240),
    experience: text(input.experience, 80),
    availability: text(input.availability, 240),
    transport: text(input.transport, 80),
    services: Array.isArray(input.services)
      ? input.services.map((service) => text(service, 80)).filter((service) => Object.values(cleanerServiceFields).includes(service))
      : Object.entries(cleanerServiceFields).filter(([field]) => input[field] === true).map(([, service]) => service),
    rightToWork: input.rightToWork === true,
    consent: input.consent === true,
    notes: text(input.notes, 1000)
  };

  const errors = [];
  required(record.fullName, "Full name", errors);
  required(record.email, "Email", errors);
  required(record.phone, "Phone", errors);
  required(record.postcode, "Home postcode", errors);
  required(record.travelAreas, "Areas you can work", errors);
  required(record.experience, "Experience", errors);
  required(record.availability, "Availability", errors);
  if (!record.services.length) errors.push("Choose at least one type of cleaning work.");
  if (record.email && !isEmail(record.email)) errors.push("Enter a valid email address.");
  if (record.phone && !isPhone(record.phone)) errors.push("Enter a valid phone number.");
  if (record.postcode && !isUkPostcode(record.postcode)) errors.push("Enter a valid UK postcode.");
  if (!record.rightToWork) errors.push("You must confirm your right to work in the UK.");
  if (!record.consent) errors.push("Privacy consent is required.");
  if (errors.length) return json(response, 422, { ok: false, errors });

  await saveRecord("cleaner-applications.ndjson", record);
  return json(response, 201, { ok: true, reference: record.id });
}

async function serveFile(requestPath, response) {
  const routes = {
    "/": "index.html",
    "/request": "index.html",
    "/join": "index.html",
    "/admin": "admin.html",
    "/privacy": "privacy.html",
    "/terms": "terms.html"
  };
  const relative = routes[requestPath] || requestPath.replace(/^\/+/, "");
  const filePath = path.resolve(publicDir, relative);
  if (!filePath.startsWith(`${path.resolve(publicDir)}${path.sep}`)) return false;

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return false;
    const body = await readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=3600"
    });
    response.end(body);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (request, response) => {
  setSecurityHeaders(response);
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  try {
    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      return json(response, 200, { ok: true, service: "tideway-marketplace" });
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/cleaning-requests") {
      return await handleCleaningRequest(request, response);
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/cleaner-applications") {
      return await handleCleanerApplication(request, response);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/admin/records") {
      return await getAdminRecords(request, response);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/admin/matches") {
      return await getAdminMatches(request, response, text(requestUrl.searchParams.get("requestId"), 40));
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/admin/proposals") {
      return await createAdminProposal(request, response);
    }
    if (request.method === "PATCH" && requestUrl.pathname === "/api/admin/proposals/status") {
      return await updateAdminProposalStatus(request, response);
    }
    if (request.method === "PATCH" && requestUrl.pathname === "/api/admin/status") {
      return await updateAdminStatus(request, response);
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/admin/activity") {
      return await addAdminActivity(request, response);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/admin/config") {
      return await getAdminConfig(request, response);
    }
    if (request.method === "PUT" && requestUrl.pathname === "/api/admin/config") {
      return await updateAdminConfig(request, response);
    }
    if (request.method === "GET" || request.method === "HEAD") {
      if (await serveFile(requestUrl.pathname, response)) return;
    }
    json(response, 404, { ok: false, error: "Not found." });
  } catch (error) {
    console.error(error);
    json(response, error.statusCode || 500, { ok: false, error: error.statusCode ? error.message : "Something went wrong. Please try again." });
  }
});

server.listen(port, host, () => {
  console.log(`Tideway is running at http://${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

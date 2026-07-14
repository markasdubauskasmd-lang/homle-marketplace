import { createServer } from "node:http";
import { appendFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checklistFromTranscript, normaliseChecklistTask } from "./public/checklist.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, "data");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const maxBodyBytes = 64 * 1024;
const maxBriefBodyBytes = 8 * 1024 * 1024;
let writeQueue = Promise.resolve();

const statusOptions = {
  request: new Set(["new", "contacted", "quoted", "booked", "completed", "lost"]),
  cleaner: new Set(["new", "contacted", "screening", "approved", "paused", "rejected"])
};

const statusTransitions = {
  request: {
    new: new Set(["contacted", "lost"]),
    contacted: new Set(["quoted", "lost"]),
    quoted: new Set(["lost"]),
    booked: new Set(["lost"]),
    completed: new Set([]),
    lost: new Set([])
  },
  cleaner: {
    new: new Set(["contacted", "screening", "rejected"]),
    contacted: new Set(["screening", "rejected"]),
    screening: new Set(["approved", "rejected"]),
    approved: new Set(["paused"]),
    paused: new Set(["approved", "rejected"]),
    rejected: new Set([])
  }
};

const cleanerScreeningChecks = [
  "identityChecked",
  "rightToWorkChecked",
  "referencesChecked",
  "serviceSkillsChecked",
  "availabilityCoverageChecked",
  "engagementTermsChecked",
  "safeguardingDecisionChecked"
];

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

function setSecurityHeaders(response, requestPath = "") {
  response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", requestPath === "/brief" ? "camera=(self), microphone=(self), geolocation=()" : "camera=(), microphone=(), geolocation=()");
}

function json(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request, limit = maxBodyBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limit) throw Object.assign(new Error("Request is too large."), { statusCode: 413 });
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

async function cleanupStaleTemporaryFiles() {
  await mkdir(dataDir, { recursive: true });
  const filenames = await readdir(dataDir);
  const stale = filenames.filter((filename) => /^business-config\.json\.[0-9a-f-]+\.tmp$/i.test(filename));
  await Promise.all(stale.map((filename) => unlink(path.join(dataDir, filename)).catch(() => {})));
}

function decodeBriefPhoto(input, index) {
  const area = text(input?.area, 80) || `Photo ${index + 1}`;
  const dataUrl = typeof input?.dataUrl === "string" ? input.dataUrl : "";
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw Object.assign(new Error(`Photo ${index + 1} must be a JPEG, PNG or WebP image.`), { statusCode: 422 });
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 900 * 1024) throw Object.assign(new Error(`Photo ${index + 1} must be under 900 KB after resizing.`), { statusCode: 422 });
  const mimeType = match[1];
  const validSignature = mimeType === "image/jpeg"
    ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mimeType === "image/png"
      ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (!validSignature) throw Object.assign(new Error(`Photo ${index + 1} is not a valid ${mimeType.replace("image/", "").toUpperCase()} image.`), { statusCode: 422 });
  const extension = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[mimeType];
  const id = `IMG-${randomUUID().slice(0, 8).toUpperCase()}`;
  return { id, area, mimeType, extension, bytes };
}

async function saveJobBrief(record, images) {
  const operation = writeQueue.catch(() => {}).then(async () => {
    const briefDirectory = path.join(dataDir, "job-brief-images", record.id);
    await mkdir(briefDirectory, { recursive: true, mode: 0o700 });
    for (const image of images) {
      await writeFile(path.join(briefDirectory, `${image.id}${image.extension}`), image.bytes, { mode: 0o600 });
    }
    await appendFile(path.join(dataDir, "job-briefs.ndjson"), `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  });
  writeQueue = operation;
  return operation;
}

function launchReadiness(config) {
  const checks = {
    identity: Boolean(config.legalOwnerName && config.businessStructure && config.legalBusinessName && config.tradingAddress),
    contact: Boolean(config.supportEmail && isEmail(config.supportEmail) && config.supportPhone && isPhone(config.supportPhone)),
    pilotArea: Boolean(config.pilotPostcodes),
    economics: Boolean(config.customerHourlyRate > 0 && config.cleanerHourlyPay > 0 && config.minimumHours > 0 && config.minimumContributionMarginPercent > 0 && config.minimumContributionMarginPercent < 100 && config.customerHourlyRate > config.cleanerHourlyPay),
    insurance: config.insuranceStatus === "active",
    payments: Boolean(config.paymentProviderStatus === "live" && config.paymentProviderName && config.refundProcess),
    operatingRules: Boolean(config.cleanerModel && config.cleanerModel !== "Undecided" && config.cancellationPolicy && config.paymentTiming)
  };
  return { checks, completed: Object.values(checks).filter(Boolean).length, total: Object.keys(checks).length, ready: Object.values(checks).every(Boolean) };
}

function applyBriefStatus(brief, updates) {
  let status = brief.status || "landlord-draft";
  let reviewNote = "";
  let reviewedAt = "";
  for (const update of updates) {
    if (update.briefId !== brief.id) continue;
    status = update.status;
    reviewNote = update.note || "";
    reviewedAt = update.updatedAt;
  }
  return { ...brief, status, reviewNote, reviewedAt };
}

function latestCleanerScreening(cleanerId, screenings) {
  let latest = null;
  for (const screening of screenings) if (screening.cleanerId === cleanerId) latest = screening;
  return latest;
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
  const [requests, cleaners, updates, activities, proposals, proposalUpdates, bookings, outcomes, briefs, briefUpdates, screenings] = await Promise.all([
    readRecords("cleaning-requests.ndjson"),
    readRecords("cleaner-applications.ndjson"),
    readRecords("status-updates.ndjson"),
    readRecords("lead-activity.ndjson"),
    readRecords("match-proposals.ndjson"),
    readRecords("proposal-status.ndjson"),
    readRecords("bookings.ndjson"),
    readRecords("job-outcomes.ndjson"),
    readRecords("job-briefs.ndjson"),
    readRecords("job-brief-status.ndjson"),
    readRecords("cleaner-screening.ndjson")
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
  const bookingsByRequest = new Map();
  for (const booking of bookings) bookingsByRequest.set(booking.requestId, booking);
  const outcomesByBooking = new Map();
  for (const outcome of outcomes) outcomesByBooking.set(outcome.bookingId, outcome);
  const briefsByRequest = new Map();
  for (const brief of briefs) {
    const list = briefsByRequest.get(brief.requestId) || [];
    list.push(applyBriefStatus(brief, briefUpdates));
    briefsByRequest.set(brief.requestId, list);
  }
  const merge = (record, kind) => {
    const leadActivities = (activitiesById.get(record.id) || []).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const leadProposals = (proposalsByRequest.get(record.id) || []).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const booking = kind === "request" ? bookingsByRequest.get(record.id) || null : null;
    const outcome = booking ? outcomesByBooking.get(booking.id) || null : null;
    const leadBriefs = kind === "request" ? (briefsByRequest.get(record.id) || []).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 5) : [];
    const screening = kind === "cleaner" ? latestCleanerScreening(record.id, screenings) : null;
    return { ...record, kind, status: latestStatuses.get(record.id) || record.status || "new", activities: leadActivities.slice(0, 10), nextActionAt: leadActivities.find((activity) => activity.nextActionAt)?.nextActionAt || "", proposals: leadProposals.slice(0, 5), briefs: leadBriefs, screening, booking, outcome };
  };
  const records = [
    ...requests.map((record) => merge(record, "request")),
    ...cleaners.map((record) => merge(record, "cleaner"))
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return json(response, 200, { ok: true, records });
}

async function updateAdminCleanerScreening(request, response) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  ensureSameOrigin(request);
  const input = await readJson(request);
  const cleanerId = text(input.cleanerId, 40);
  const cleaners = await readRecords("cleaner-applications.ndjson");
  if (!cleaners.some((cleaner) => cleaner.id === cleanerId)) return json(response, 404, { ok: false, error: "Cleaner application not found." });
  const checks = Object.fromEntries(cleanerScreeningChecks.map((key) => [key, input[key] === true]));
  const completed = cleanerScreeningChecks.filter((key) => checks[key]).length;
  const screening = {
    id: `SCR-${randomUUID().slice(0, 8).toUpperCase()}`,
    cleanerId,
    ...checks,
    completed,
    total: cleanerScreeningChecks.length,
    complete: completed === cleanerScreeningChecks.length,
    note: text(input.note, 1000),
    updatedAt: new Date().toISOString()
  };
  await saveRecord("cleaner-screening.ndjson", screening);
  return json(response, 200, { ok: true, screening });
}

async function updateAdminJobBriefStatus(request, response) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  ensureSameOrigin(request);
  const input = await readJson(request);
  const briefId = text(input.briefId, 40);
  const status = text(input.status, 30);
  const note = text(input.note, 1000);
  const transitions = {
    "landlord-draft": new Set(["reviewed", "needs-revision"]),
    reviewed: new Set([]),
    "needs-revision": new Set([])
  };
  const [briefs, updates] = await Promise.all([
    readRecords("job-briefs.ndjson"),
    readRecords("job-brief-status.ndjson")
  ]);
  const brief = briefs.find((record) => record.id === briefId);
  if (!brief) return json(response, 404, { ok: false, error: "Job brief not found." });
  const currentStatus = applyBriefStatus(brief, updates).status;
  if (!transitions[currentStatus]?.has(status)) {
    return json(response, 422, { ok: false, error: `Job brief cannot move from ${currentStatus} to ${status}. Submit a new brief when revisions are needed.` });
  }
  if (status === "needs-revision" && !note) {
    return json(response, 422, { ok: false, error: "Add a clear revision note so the landlord knows what must be corrected." });
  }
  const update = { briefId, requestId: brief.requestId, status, previousStatus: currentStatus, note, updatedAt: new Date().toISOString() };
  await saveRecord("job-brief-status.ndjson", update);
  return json(response, 200, { ok: true, briefId, status, reviewNote: note, reviewedAt: update.updatedAt });
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
  const [proposals, updates, config, briefs, briefUpdates] = await Promise.all([
    readRecords("match-proposals.ndjson"),
    readRecords("proposal-status.ndjson"),
    readJsonFile("business-config.json", {}),
    readRecords("job-briefs.ndjson"),
    readRecords("job-brief-status.ndjson")
  ]);
  const proposal = proposals.find((record) => record.id === proposalId);
  if (!proposal) return json(response, 404, { ok: false, error: "Proposal not found." });
  let currentStatus = proposal.status || "draft";
  for (const update of updates) if (update.proposalId === proposalId) currentStatus = update.status;
  if (!transitions[currentStatus]?.has(status)) return json(response, 422, { ok: false, error: `Proposal cannot move from ${currentStatus} to ${status}.` });
  if (["ready", "sent", "accepted"].includes(status) && !launchReadiness(config).ready) {
    return json(response, 422, { ok: false, error: "Complete all seven launch-readiness checks before advancing this proposal." });
  }
  const latestBrief = briefs.filter((brief) => brief.requestId === proposal.requestId).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] || null;
  if (["ready", "sent", "accepted"].includes(status) && latestBrief && applyBriefStatus(latestBrief, briefUpdates).status !== "reviewed") {
    return json(response, 422, { ok: false, error: "Review and approve the latest landlord photo job brief before advancing this proposal." });
  }
  if (["ready", "sent", "accepted"].includes(status) && proposal.estimatedHours < config.minimumHours) {
    return json(response, 422, { ok: false, error: `This proposal's ${proposal.estimatedHours} estimated hours are below the ${config.minimumHours}-hour minimum.` });
  }
  if (["ready", "sent", "accepted"].includes(status) && (!Number.isFinite(proposal.marginPercent) || proposal.marginPercent < config.minimumContributionMarginPercent)) {
    const proposalMargin = Number.isFinite(proposal.marginPercent) ? `${proposal.marginPercent.toFixed(1)}%` : "unrecorded";
    return json(response, 422, { ok: false, error: `This proposal's ${proposalMargin} contribution margin is below the ${config.minimumContributionMarginPercent.toFixed(1)}% minimum.` });
  }
  const update = { proposalId, requestId: proposal.requestId, status, previousStatus: currentStatus, updatedAt: new Date().toISOString() };
  await saveRecord("proposal-status.ndjson", update);
  return json(response, 200, { ok: true, proposalId, status });
}

async function getAdminProposalDrafts(request, response, proposalId) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  const [proposals, proposalUpdates, customerRequests, cleaners, config, briefs, briefUpdates] = await Promise.all([
    readRecords("match-proposals.ndjson"),
    readRecords("proposal-status.ndjson"),
    readRecords("cleaning-requests.ndjson"),
    readRecords("cleaner-applications.ndjson"),
    readJsonFile("business-config.json", {}),
    readRecords("job-briefs.ndjson"),
    readRecords("job-brief-status.ndjson")
  ]);
  const proposal = proposals.find((record) => record.id === proposalId);
  if (!proposal) return json(response, 404, { ok: false, error: "Proposal not found." });
  const customerRequest = customerRequests.find((record) => record.id === proposal.requestId);
  const cleaner = cleaners.find((record) => record.id === proposal.cleanerId);
  if (!customerRequest || !cleaner) return json(response, 404, { ok: false, error: "Proposal parties were not found." });
  let proposalStatus = proposal.status || "draft";
  for (const update of proposalUpdates) if (update.proposalId === proposalId) proposalStatus = update.status;

  const readiness = launchReadiness(config);
  const rawLatestBrief = briefs.filter((brief) => brief.requestId === customerRequest.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] || null;
  const latestBrief = rawLatestBrief ? applyBriefStatus(rawLatestBrief, briefUpdates) : null;
  const briefReviewed = !latestBrief || latestBrief.status === "reviewed";
  const warnings = [];
  if (!readiness.ready) warnings.push("Complete all seven launch-readiness checks before using these drafts.");
  if (!["ready", "sent", "accepted"].includes(proposalStatus)) warnings.push("The proposal is still a draft and has not been internally approved.");
  if (!briefReviewed) warnings.push("Review and approve the latest landlord photo job brief before using the cleaner draft.");
  if (!config.cancellationPolicy) warnings.push("Add an approved cancellation rule.");
  if (!config.paymentTiming) warnings.push("Add the customer payment timing.");
  if (!config.supportEmail || !config.supportPhone) warnings.push("Add verified support contact details.");

  const money = (value) => `£${Number(value).toFixed(2)}`;
  const signoff = [config.legalBusinessName || "Tideway", config.supportEmail, config.supportPhone].filter(Boolean).join("\n");
  const customerBody = [
    `Hello ${customerRequest.contactName},`,
    "",
    `Thank you for requesting ${customerRequest.service.toLowerCase()} in ${customerRequest.postcode}.`,
    "",
    `Proposed date: ${proposal.proposedDate}`,
    `Site scope: ${customerRequest.siteSize || "[Confirm site size before sending]"}`,
    `Estimated cleaning time: ${proposal.estimatedHours} hours`,
    `Proposed customer total: ${money(proposal.customerTotal)}`,
    "",
    `Cancellation: ${config.cancellationPolicy || "[Add the approved cancellation rule before sending]"}`,
    `Payment timing: ${config.paymentTiming || "[Add the approved payment timing before sending]"}`,
    "",
    "This is a proposal, not a confirmed booking. Tideway will only confirm after you accept the scope and price and an approved cleaner has confirmed availability.",
    "",
    "Kind regards,",
    signoff
  ].join("\n");
  const outwardCode = customerRequest.postcode.replace(/\s+/g, " ").split(" ")[0];
  const cleanerBody = [
    `Hello ${cleaner.fullName},`,
    "",
    "A Tideway pilot cleaning opportunity may suit your services and work area.",
    "",
    `Service: ${customerRequest.service}`,
    `Area: ${outwardCode}`,
    `Site scope: ${customerRequest.siteSize || "Confirm before accepting"}`,
    `Known hazards: ${customerRequest.hazards || "Confirm before accepting"}`,
    `Proposed date: ${proposal.proposedDate}`,
    `Estimated time: ${proposal.estimatedHours} hours`,
    `Proposed cleaner pay: ${money(proposal.cleanerPay)} total (${money(proposal.cleanerRate)} per hour)`,
    ...(latestBrief ? ["", latestBrief.status === "reviewed" ? "Tideway-reviewed cleaner checklist:" : "Landlord-draft cleaner checklist (Tideway review required):", ...latestBrief.checklist.map((task) => `- ${task}`), `Photo references held privately: ${latestBrief.photos.length}. Share only through the approved secure process after confirmation.`] : []),
    "",
    "This is an invitation to consider the opportunity, not a confirmed assignment. You may accept or decline. Full access details are shared only after both sides confirm.",
    "",
    `Tideway operating model: ${config.cleanerModel || "[Confirm the approved cleaner engagement model before sending]"}`,
    "",
    "Kind regards,",
    signoff
  ].join("\n");

  return json(response, 200, {
    ok: true,
    proposalId,
    proposalStatus,
    sendAllowed: readiness.ready && briefReviewed && ["ready", "sent", "accepted"].includes(proposalStatus),
    warnings,
    customer: { subject: `Tideway cleaning proposal ${proposal.id}`, body: customerBody },
    cleaner: { subject: `Tideway cleaning opportunity ${proposal.id}`, body: cleanerBody }
  });
}

async function buildBookingAudit(proposalId) {
  const [proposals, proposalUpdates, customerRequests, cleaners, cleanerUpdates, config, briefs, briefUpdates, screenings] = await Promise.all([
    readRecords("match-proposals.ndjson"),
    readRecords("proposal-status.ndjson"),
    readRecords("cleaning-requests.ndjson"),
    readRecords("cleaner-applications.ndjson"),
    readRecords("status-updates.ndjson"),
    readJsonFile("business-config.json", {}),
    readRecords("job-briefs.ndjson"),
    readRecords("job-brief-status.ndjson"),
    readRecords("cleaner-screening.ndjson")
  ]);
  const proposal = proposals.find((record) => record.id === proposalId);
  if (!proposal) return { statusCode: 404, error: "Proposal not found." };
  const customerRequest = customerRequests.find((record) => record.id === proposal.requestId);
  const cleaner = cleaners.find((record) => record.id === proposal.cleanerId);
  if (!customerRequest || !cleaner) return { statusCode: 404, error: "Proposal parties were not found." };
  let proposalStatus = proposal.status || "draft";
  for (const update of proposalUpdates) if (update.proposalId === proposalId) proposalStatus = update.status;
  let cleanerStatus = cleaner.status || "new";
  for (const update of cleanerUpdates) if (update.id === cleaner.id) cleanerStatus = update.status;
  const requiredService = requestServiceMap[customerRequest.service] || "";
  const rawLatestBrief = briefs.filter((brief) => brief.requestId === customerRequest.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] || null;
  const latestBrief = rawLatestBrief ? applyBriefStatus(rawLatestBrief, briefUpdates) : null;
  const checks = {
    launchReady: launchReadiness(config).ready,
    proposalAccepted: proposalStatus === "accepted",
    cleanerApproved: cleanerStatus === "approved",
    cleanerScreened: latestCleanerScreening(cleaner.id, screenings)?.complete === true,
    serviceApproved: !requiredService || cleaner.services?.includes(requiredService),
    profitable: proposal.contribution > 0,
    marginFloorMet: config.minimumContributionMarginPercent > 0 && proposal.marginPercent >= config.minimumContributionMarginPercent,
    minimumHoursMet: config.minimumHours > 0 && proposal.estimatedHours >= config.minimumHours,
    briefReviewed: !latestBrief || latestBrief.status === "reviewed",
    scopeCaptured: Boolean(customerRequest.siteSize),
    accessCaptured: Boolean(customerRequest.accessNotes),
    hazardsCaptured: Boolean(customerRequest.hazards)
  };
  const automatedReady = Object.values(checks).every(Boolean);
  const manualChecklist = [
    "Confirm the exact service address and named access contact through the approved secure process.",
    "Confirm the final task checklist, exclusions, products and equipment with both sides.",
    "Confirm the customer payment authorisation without storing card details in Tideway notes.",
    "Confirm the cleaner has accepted the date, scope and proposed pay.",
    "Share emergency and issue-reporting instructions before the visit."
  ];
  return { ok: true, proposal, customerRequest, cleaner, proposalId, proposalStatus, automatedReady, checks, manualChecklist };
}

async function getAdminBookingAudit(request, response, proposalId) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  const audit = await buildBookingAudit(proposalId);
  if (!audit.ok) return json(response, audit.statusCode, { ok: false, error: audit.error });
  const { proposal, customerRequest, cleaner, ...publicAudit } = audit;
  return json(response, 200, publicAudit);
}

async function createAdminBooking(request, response) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  ensureSameOrigin(request);
  const input = await readJson(request);
  const proposalId = text(input.proposalId, 40);
  const confirmations = {
    addressAndAccessConfirmed: input.addressAndAccessConfirmed === true,
    finalChecklistConfirmed: input.finalChecklistConfirmed === true,
    paymentAuthorisationConfirmed: input.paymentAuthorisationConfirmed === true,
    cleanerAcceptanceConfirmed: input.cleanerAcceptanceConfirmed === true,
    emergencyInstructionsConfirmed: input.emergencyInstructionsConfirmed === true
  };
  if (!proposalId || !Object.values(confirmations).every(Boolean)) {
    return json(response, 422, { ok: false, error: "Complete every manual booking confirmation before recording a booking." });
  }
  const audit = await buildBookingAudit(proposalId);
  if (!audit.ok) return json(response, audit.statusCode, { ok: false, error: audit.error });
  if (!audit.automatedReady) return json(response, 422, { ok: false, error: "The automated booking audit must pass before recording a booking.", checks: audit.checks });

  const [updates, bookings] = await Promise.all([
    readRecords("status-updates.ndjson"),
    readRecords("bookings.ndjson")
  ]);
  let requestStatus = audit.customerRequest.status || "new";
  for (const update of updates) if (update.id === audit.customerRequest.id) requestStatus = update.status;
  if (requestStatus !== "quoted") return json(response, 422, { ok: false, error: "Move the customer request through contacted to quoted before recording a booking." });
  if (bookings.some((booking) => booking.requestId === audit.customerRequest.id || booking.proposalId === proposalId)) {
    return json(response, 409, { ok: false, error: "A booking is already recorded for this request or proposal." });
  }

  const booking = {
    id: `BKG-${randomUUID().slice(0, 8).toUpperCase()}`,
    proposalId,
    requestId: audit.customerRequest.id,
    cleanerId: audit.cleaner.id,
    proposedDate: audit.proposal.proposedDate,
    plannedCustomerTotal: audit.proposal.customerTotal,
    plannedCleanerPay: audit.proposal.cleanerPay,
    plannedContribution: audit.proposal.contribution,
    confirmations,
    internalNote: text(input.internalNote, 1000),
    createdAt: new Date().toISOString()
  };
  await saveRecord("bookings.ndjson", booking);
  await saveRecord("status-updates.ndjson", { id: booking.requestId, kind: "request", status: "booked", previousStatus: requestStatus, source: "booking-confirmation", updatedAt: booking.createdAt });
  return json(response, 201, { ok: true, booking });
}

async function createAdminJobOutcome(request, response) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  ensureSameOrigin(request);
  const input = await readJson(request);
  const bookingId = text(input.bookingId, 40);
  const actualHours = Number(input.actualHours);
  const customerCollected = Number(input.customerCollected);
  const cleanerPaid = Number(input.cleanerPaid);
  const otherCosts = Number(input.otherCosts || 0);
  const refundAmount = Number(input.refundAmount || 0);
  const values = [actualHours, customerCollected, cleanerPaid, otherCosts, refundAmount];
  if (!bookingId || values.some((value) => !Number.isFinite(value)) || actualHours <= 0 || customerCollected <= 0 || cleanerPaid < 0 || otherCosts < 0 || refundAmount < 0) {
    return json(response, 422, { ok: false, error: "Enter valid actual hours and non-negative job amounts; customer collected must be greater than zero." });
  }
  const [bookings, outcomes, updates, config] = await Promise.all([
    readRecords("bookings.ndjson"),
    readRecords("job-outcomes.ndjson"),
    readRecords("status-updates.ndjson"),
    readJsonFile("business-config.json", {})
  ]);
  const booking = bookings.find((record) => record.id === bookingId);
  if (!booking) return json(response, 404, { ok: false, error: "Booking not found." });
  if (outcomes.some((record) => record.bookingId === bookingId)) return json(response, 409, { ok: false, error: "A completed-job outcome is already recorded for this booking." });
  let requestStatus = "new";
  for (const update of updates) if (update.id === booking.requestId) requestStatus = update.status;
  if (requestStatus !== "booked") return json(response, 422, { ok: false, error: "Only a booked request can be completed." });

  const contribution = customerCollected - cleanerPaid - otherCosts - refundAmount;
  const marginPercent = (contribution / customerCollected) * 100;
  const outcome = {
    id: `JOB-${randomUUID().slice(0, 8).toUpperCase()}`,
    bookingId,
    requestId: booking.requestId,
    cleanerId: booking.cleanerId,
    actualHours,
    customerCollected,
    cleanerPaid,
    otherCosts,
    refundAmount,
    contribution,
    marginPercent,
    profitable: contribution > 0,
    targetMarginPercent: config.minimumContributionMarginPercent || 0,
    metTargetMargin: config.minimumContributionMarginPercent > 0 && marginPercent >= config.minimumContributionMarginPercent,
    internalNote: text(input.internalNote, 1000),
    createdAt: new Date().toISOString()
  };
  await saveRecord("job-outcomes.ndjson", outcome);
  await saveRecord("status-updates.ndjson", { id: booking.requestId, kind: "request", status: "completed", previousStatus: requestStatus, source: "job-outcome", updatedAt: outcome.createdAt });
  return json(response, 201, { ok: true, outcome });
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

  const [requests, cleaners, updates, config, screenings] = await Promise.all([
    readRecords("cleaning-requests.ndjson"),
    readRecords("cleaner-applications.ndjson"),
    readRecords("status-updates.ndjson"),
    readJsonFile("business-config.json", {}),
    readRecords("cleaner-screening.ndjson")
  ]);
  const customerRequest = requests.find((record) => record.id === requestId);
  const cleaner = cleaners.find((record) => record.id === cleanerId);
  const latestStatuses = new Map();
  for (const update of updates) latestStatuses.set(update.id, update.status);
  if (!customerRequest || !cleaner) return json(response, 404, { ok: false, error: "Customer request or cleaner was not found." });
  if ((latestStatuses.get(cleaner.id) || cleaner.status) !== "approved") return json(response, 422, { ok: false, error: "Only an approved cleaner can be proposed." });
  if (!latestCleanerScreening(cleaner.id, screenings)?.complete) return json(response, 422, { ok: false, error: "Only a fully screened cleaner can be proposed." });
  if (config.minimumHours > 0 && estimatedHours < config.minimumHours) return json(response, 422, { ok: false, error: `Estimated hours must meet the ${config.minimumHours}-hour minimum.` });
  const requiredService = requestServiceMap[customerRequest.service] || "";
  if (requiredService && !cleaner.services?.includes(requiredService)) return json(response, 422, { ok: false, error: "Cleaner is not approved for the requested service." });

  const customerTotal = estimatedHours * customerRate;
  const cleanerPay = estimatedHours * cleanerRate;
  const contribution = customerTotal - cleanerPay - otherCosts;
  if (contribution <= 0) return json(response, 422, { ok: false, error: "This proposal loses money before overheads. Change the price, pay or scope." });
  const marginPercent = (contribution / customerTotal) * 100;
  if (config.minimumContributionMarginPercent > 0 && marginPercent < config.minimumContributionMarginPercent) {
    return json(response, 422, { ok: false, error: `This proposal's ${marginPercent.toFixed(1)}% contribution margin is below the ${config.minimumContributionMarginPercent.toFixed(1)}% minimum.` });
  }
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
  const [requests, cleaners, updates, screenings] = await Promise.all([
    readRecords("cleaning-requests.ndjson"),
    readRecords("cleaner-applications.ndjson"),
    readRecords("status-updates.ndjson"),
    readRecords("cleaner-screening.ndjson")
  ]);
  const customerRequest = requests.find((record) => record.id === requestId);
  if (!customerRequest) return json(response, 404, { ok: false, error: "Customer request not found." });

  const latestStatuses = new Map();
  for (const update of updates) latestStatuses.set(update.id, update.status);
  const requiredService = requestServiceMap[customerRequest.service] || "";
  const outwardCode = customerRequest.postcode.replace(/\s+/g, " ").split(" ")[0].toUpperCase();
  const postcodeArea = outwardCode.match(/^[A-Z]+/)?.[0] || "";

  const matches = cleaners
    .filter((cleaner) => (latestStatuses.get(cleaner.id) || cleaner.status) === "approved" && latestCleanerScreening(cleaner.id, screenings)?.complete)
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
    paymentProviderName: text(input.paymentProviderName, 120),
    paymentProviderStatus: text(input.paymentProviderStatus, 40),
    refundProcess: text(input.refundProcess, 800),
    customerHourlyRate: Math.max(0, Number(input.customerHourlyRate) || 0),
    cleanerHourlyPay: Math.max(0, Number(input.cleanerHourlyPay) || 0),
    minimumHours: Math.max(0, Number(input.minimumHours) || 0),
    minimumContributionMarginPercent: Math.max(0, Number(input.minimumContributionMarginPercent) || 0),
    cancellationPolicy: text(input.cancellationPolicy, 1000),
    paymentTiming: text(input.paymentTiming, 100),
    updatedAt: new Date().toISOString()
  };
  const errors = [];
  if (config.supportEmail && !isEmail(config.supportEmail)) errors.push("Enter a valid support email.");
  if (config.supportPhone && !isPhone(config.supportPhone)) errors.push("Enter a valid support phone number.");
  if (config.customerHourlyRate > 0 && config.cleanerHourlyPay > 0 && config.customerHourlyRate <= config.cleanerHourlyPay) errors.push("Customer rate must be higher than cleaner pay before other costs.");
  if (config.minimumContributionMarginPercent >= 100) errors.push("Minimum contribution margin must be below 100%.");
  if (config.paymentProviderStatus === "live" && (!config.paymentProviderName || !config.refundProcess)) errors.push("Add the live payment provider and refund process.");
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
  const [records, updates, screenings] = await Promise.all([readRecords(source), readRecords("status-updates.ndjson"), readRecords("cleaner-screening.ndjson")]);
  const record = records.find((item) => item.id === id);
  if (!record) return json(response, 404, { ok: false, error: "Record not found." });
  let currentStatus = record.status || "new";
  for (const update of updates) if (update.id === id) currentStatus = update.status;
  if (currentStatus === status) return json(response, 200, { ok: true, id, status });
  if (!statusTransitions[kind]?.[currentStatus]?.has(status)) {
    const workflowHint = kind === "request" && ["booked", "completed"].includes(status) ? " Use the confirmed-booking or completed-job workflow." : "";
    return json(response, 422, { ok: false, error: `Status cannot move from ${currentStatus} to ${status}.${workflowHint}` });
  }
  if (kind === "cleaner" && status === "approved" && !latestCleanerScreening(id, screenings)?.complete) {
    return json(response, 422, { ok: false, error: "Complete all seven cleaner-screening checks before marking this application approved." });
  }

  await saveRecord("status-updates.ndjson", { id, kind, status, previousStatus: currentStatus, source: "manual", updatedAt: new Date().toISOString() });
  return json(response, 200, { ok: true, id, status });
}

async function handleJobBrief(request, response) {
  ensureSameOrigin(request);
  const input = await readJson(request, maxBriefBodyBytes);
  const requestId = text(input.requestId, 40).toUpperCase();
  const email = text(input.email, 160).toLowerCase();
  const transcript = text(input.transcript, 5000);
  const consent = input.consent === true;
  const suppliedTasks = Array.isArray(input.checklist) ? input.checklist.map(normaliseChecklistTask).filter(Boolean) : [];
  const checklist = [...new Map((suppliedTasks.length ? suppliedTasks : checklistFromTranscript(transcript)).map((task) => [task.toLowerCase(), task])).values()].slice(0, 40);
  const photoInputs = Array.isArray(input.photos) ? input.photos.slice(0, 7) : [];
  const errors = [];
  if (!/^REQ-[A-Z0-9]{8}$/.test(requestId)) errors.push("Enter a valid Tideway cleaning-request reference.");
  if (!isEmail(email)) errors.push("Enter the email used for the cleaning request.");
  if (!transcript) errors.push("Add or dictate the cleaning instructions.");
  if (!checklist.length) errors.push("Generate and review at least one checklist task.");
  if (!photoInputs.length) errors.push("Add at least one property photo.");
  if (photoInputs.length > 6) errors.push("Add no more than six property photos.");
  if (!consent) errors.push("Confirm that you may share these property photos and instructions.");
  if (errors.length) return json(response, 422, { ok: false, errors });

  const [requests, updates, existingBriefs] = await Promise.all([
    readRecords("cleaning-requests.ndjson"),
    readRecords("status-updates.ndjson"),
    readRecords("job-briefs.ndjson")
  ]);
  const customerRequest = requests.find((record) => record.id === requestId && record.email === email);
  if (!customerRequest) return json(response, 404, { ok: false, error: "The request reference and email could not be matched." });
  let requestStatus = customerRequest.status || "new";
  for (const update of updates) if (update.id === requestId) requestStatus = update.status;
  if (["completed", "lost"].includes(requestStatus)) return json(response, 422, { ok: false, error: "This request is closed and cannot accept a new job brief." });
  if (existingBriefs.filter((brief) => brief.requestId === requestId).length >= 5) return json(response, 422, { ok: false, error: "This request already has five job-brief versions. Review them in the control desk before adding another." });

  const images = photoInputs.map(decodeBriefPhoto);
  const totalImageBytes = images.reduce((total, image) => total + image.bytes.length, 0);
  if (totalImageBytes > 5 * 1024 * 1024) return json(response, 422, { ok: false, error: "The resized photos must total no more than 5 MB." });
  const briefId = `BRF-${randomUUID().slice(0, 8).toUpperCase()}`;
  const photos = images.map((image) => ({
    id: image.id,
    area: image.area,
    mimeType: image.mimeType,
    storedPath: path.posix.join("job-brief-images", briefId, `${image.id}${image.extension}`)
  }));
  const brief = {
    id: briefId,
    requestId,
    transcript,
    checklist,
    photos,
    status: "landlord-draft",
    createdAt: new Date().toISOString()
  };
  await saveJobBrief(brief, images);
  return json(response, 201, { ok: true, reference: brief.id, checklist: brief.checklist, photos: brief.photos.map(({ id, area }) => ({ id, area })) });
}

async function getAdminJobBriefImage(request, response, briefId, imageId) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  const briefs = await readRecords("job-briefs.ndjson");
  const brief = briefs.find((record) => record.id === briefId);
  const photo = brief?.photos?.find((item) => item.id === imageId);
  if (!photo) return json(response, 404, { ok: false, error: "Brief photo not found." });
  const resolvedDataDir = path.resolve(dataDir);
  const imagePath = path.resolve(dataDir, photo.storedPath);
  if (!imagePath.startsWith(`${resolvedDataDir}${path.sep}`)) return json(response, 403, { ok: false, error: "Invalid photo path." });
  try {
    const body = await readFile(imagePath);
    response.writeHead(200, { "Content-Type": photo.mimeType, "Content-Length": body.length, "Cache-Control": "private, no-store" });
    response.end(body);
  } catch (error) {
    if (error.code === "ENOENT") return json(response, 404, { ok: false, error: "Brief photo file not found." });
    throw error;
  }
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
    siteSize: text(input.siteSize, 160),
    accessNotes: text(input.accessNotes, 500),
    hazards: text(input.hazards, 120),
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
  required(record.siteSize, "Site size or rooms", errors);
  required(record.accessNotes, "Access arrangements", errors);
  required(record.hazards, "Known hazards", errors);
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
    "/brief": "brief.html",
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
      "Cache-Control": extension === ".html" ? "no-store" : "no-cache"
    });
    response.end(body);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  setSecurityHeaders(response, requestUrl.pathname);

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
    if (request.method === "POST" && requestUrl.pathname === "/api/job-briefs") {
      return await handleJobBrief(request, response);
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
    if (request.method === "PATCH" && requestUrl.pathname === "/api/admin/job-briefs/status") {
      return await updateAdminJobBriefStatus(request, response);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/admin/proposal-drafts") {
      return await getAdminProposalDrafts(request, response, text(requestUrl.searchParams.get("proposalId"), 40));
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/admin/booking-audit") {
      return await getAdminBookingAudit(request, response, text(requestUrl.searchParams.get("proposalId"), 40));
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/admin/job-brief-image") {
      return await getAdminJobBriefImage(request, response, text(requestUrl.searchParams.get("briefId"), 40), text(requestUrl.searchParams.get("imageId"), 40));
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/admin/bookings") {
      return await createAdminBooking(request, response);
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/admin/job-outcomes") {
      return await createAdminJobOutcome(request, response);
    }
    if (request.method === "PATCH" && requestUrl.pathname === "/api/admin/status") {
      return await updateAdminStatus(request, response);
    }
    if (request.method === "PUT" && requestUrl.pathname === "/api/admin/cleaner-screening") {
      return await updateAdminCleanerScreening(request, response);
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

await cleanupStaleTemporaryFiles();
server.listen(port, host, () => {
  console.log(`Tideway is running at http://${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

import { createServer } from "node:http";
import { appendFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checklistFromTranscript, normaliseChecklistTask } from "./public/checklist.js";
import { briefRoomOptions, maxBriefPhotos } from "./public/brief-readiness.js";
import { detectPriceSensitiveScope, normalisePriceSensitiveScopeSignals } from "./public/scope-signals.js";
import { decisionWasInTime, offerDeadline, offerIsOpen } from "./offer-expiry.mjs";
import { cleanerTravelCoverage, parseCleanerTravelAreas } from "./travel-coverage.mjs";

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

function localDateToday(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 10);
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

async function saveProposalStatusOnce(update) {
  const operation = writeQueue.catch(() => {}).then(async () => {
    await mkdir(dataDir, { recursive: true });
    const [proposals, proposalUpdates, cleanerDecisions, bookings] = await Promise.all([
      readRecords("match-proposals.ndjson"),
      readRecords("proposal-status.ndjson"),
      readRecords("cleaner-opportunity-decisions.ndjson"),
      readRecords("bookings.ndjson")
    ]);
    const proposal = proposals.find((item) => item.id === update.proposalId);
    if (!proposal) throw Object.assign(new Error("Proposal not found."), { statusCode: 404 });
    const currentStatus = proposalLifecycle(proposal, proposalUpdates).status;
    if (currentStatus !== update.previousStatus) {
      throw Object.assign(new Error(`This proposal changed from ${update.previousStatus} to ${currentStatus}. Refresh before trying again.`), { statusCode: 409 });
    }
    if (update.status === "cancelled" && bookings.some((booking) => booking.proposalId === proposal.id)) {
      throw Object.assign(new Error("A confirmed booking cannot be withdrawn through proposal controls. Use the booking change and safety workflow."), { statusCode: 409 });
    }
    if (["ready", "sent"].includes(update.status)) {
      const competingProposal = proposals.find((candidate) => candidate.id !== proposal.id && candidate.requestId === proposal.requestId && proposalHasLiveOffer(candidate, proposalUpdates, cleanerDecisions));
      if (competingProposal) {
        throw Object.assign(new Error(`Close or exhaust the existing live proposal ${competingProposal.id} before advancing another offer for this request.`), { statusCode: 409 });
      }
      if (proposal.replacesProposalId) {
        const previousProposal = proposals.find((candidate) => candidate.id === proposal.replacesProposalId && candidate.requestId === proposal.requestId);
        if (!previousProposal) throw Object.assign(new Error("The replacement offer has no valid predecessor and cannot advance."), { statusCode: 409 });
        const previousStatus = proposalLifecycle(previousProposal, proposalUpdates).status;
        const previousClosed = ["cancelled", "declined"].includes(previousStatus) || proposalOfferIsExhausted(previousProposal, proposalUpdates, cleanerDecisions);
        if (!previousClosed) throw Object.assign(new Error(`The previous proposal ${previousProposal.id} must be closed or exhausted before its replacement can advance.`), { statusCode: 409 });
      }
    }
    if (update.status === "sent") {
      const capacityConflict = findCleanerLiveCapacityConflict(proposal, proposals, proposalUpdates, cleanerDecisions, bookings);
      if (capacityConflict) {
        throw Object.assign(new Error(`This cleaner's capacity is already held by an overlapping live offer or booking (${capacityConflict.id}). Close or exhaust that commitment, or choose another confirmed time.`), { statusCode: 409 });
      }
    }
    await appendFile(path.join(dataDir, "proposal-status.ndjson"), `${JSON.stringify(update)}\n`, { encoding: "utf8", mode: 0o600 });
  });
  writeQueue = operation;
  return operation;
}

async function saveDecisionOnce(filename, proposalId, record) {
  const operation = writeQueue.catch(() => {}).then(async () => {
    await mkdir(dataDir, { recursive: true });
    let existing = [];
    try {
      const contents = await readFile(path.join(dataDir, filename), "utf8");
      existing = contents.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const duplicate = existing.some((item) => item.proposalId === proposalId && (!record.source || item.source === record.source));
    if (duplicate) throw Object.assign(new Error("This private decision has already been recorded."), { statusCode: 409 });
    if (record.source === "customer-private-quote") {
      const [proposals, availabilityEvents, config] = await Promise.all([
        readRecords("match-proposals.ndjson"),
        readRecords("cleaner-availability.ndjson"),
        readJsonFile("business-config.json", {})
      ]);
      const proposal = proposals.find((item) => item.id === proposalId);
      if (!proposal) throw Object.assign(new Error("This cleaning proposal could not be found."), { statusCode: 404 });
      let proposalStatus = proposal.status || "draft";
      let quoteSnapshot = null;
      for (const update of existing) {
        if (update.proposalId !== proposalId) continue;
        proposalStatus = update.status;
        if (update.quoteSnapshot) quoteSnapshot = update.quoteSnapshot;
      }
      if (proposalStatus !== "sent" || !offerIsOpen(quoteSnapshot?.offerExpiresAt)) {
        throw Object.assign(new Error("This quote is no longer awaiting a decision."), { statusCode: 409 });
      }
      if (!proposalCostModelCurrent(proposal, config)) throw Object.assign(new Error("The proposal cost assumptions changed and require a new quote."), { statusCode: 409 });
      if (record.status === "accepted" && !findCleanerAvailabilitySlot(proposal.cleanerId, proposal, availabilityEvents)) {
        throw Object.assign(new Error("The proposed cleaner no longer has confirmed availability covering this visit."), { statusCode: 409 });
      }
    }
    await appendFile(path.join(dataDir, filename), `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  });
  writeQueue = operation;
  return operation;
}

async function saveCleanerDecisionOnce(record) {
  const operation = writeQueue.catch(() => {}).then(async () => {
    await mkdir(dataDir, { recursive: true });
    const [proposals, proposalUpdates, decisions, bookings, availabilityEvents, config] = await Promise.all([
      readRecords("match-proposals.ndjson"),
      readRecords("proposal-status.ndjson"),
      readRecords("cleaner-opportunity-decisions.ndjson"),
      readRecords("bookings.ndjson"),
      readRecords("cleaner-availability.ndjson"),
      readJsonFile("business-config.json", {})
    ]);
    if (decisions.some((item) => item.proposalId === record.proposalId)) {
      throw Object.assign(new Error("This private decision has already been recorded."), { statusCode: 409 });
    }
    const proposal = proposals.find((item) => item.id === record.proposalId);
    if (!proposal) throw Object.assign(new Error("This cleaning opportunity could not be found."), { statusCode: 404 });
    let proposalStatus = proposal.status || "draft";
    let opportunitySnapshot = null;
    for (const update of proposalUpdates) {
      if (update.proposalId !== proposal.id) continue;
      proposalStatus = update.status;
      if (update.cleanerOpportunitySnapshot) opportunitySnapshot = update.cleanerOpportunitySnapshot;
    }
    if (!["sent", "accepted"].includes(proposalStatus)) {
      throw Object.assign(new Error("This opportunity is no longer awaiting a decision."), { statusCode: 409 });
    }
    if (!offerIsOpen(opportunitySnapshot?.offerExpiresAt)) throw Object.assign(new Error("This opportunity's response window has ended."), { statusCode: 409 });
    if (!proposalCostModelCurrent(proposal, config)) throw Object.assign(new Error("The proposal cost assumptions changed and require a new opportunity."), { statusCode: 409 });
    if (record.status === "accepted") {
      if (!findCleanerAvailabilitySlot(proposal.cleanerId, proposal, availabilityEvents)) {
        throw Object.assign(new Error("This cleaner no longer has a confirmed availability window covering the proposed visit."), { statusCode: 409 });
      }
      const conflict = findCleanerScheduleConflict(proposal, proposals, proposalUpdates, decisions, bookings);
      if (conflict) throw Object.assign(new Error(`This cleaner already has accepted work that overlaps this time (${conflict.id}).`), { statusCode: 409 });
    }
    await appendFile(path.join(dataDir, "cleaner-opportunity-decisions.ndjson"), `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  });
  writeQueue = operation;
  return operation;
}

async function saveCleanerAvailabilityEvent(event) {
  const operation = writeQueue.catch(() => {}).then(async () => {
    await mkdir(dataDir, { recursive: true });
    const existing = await readRecords("cleaner-availability.ndjson");
    const active = activeCleanerAvailability(existing);
    if (event.action === "confirmed") {
      const schedule = availabilitySlotSchedule(event);
      const overlap = active.find((slot) => slot.cleanerId === event.cleanerId && schedulesOverlap(schedule, availabilitySlotSchedule(slot)));
      if (overlap) throw Object.assign(new Error(`This availability overlaps the active window ${overlap.id}.`), { statusCode: 409 });
    } else if (event.action === "withdrawn") {
      const current = active.find((slot) => slot.id === event.slotId && slot.cleanerId === event.cleanerId);
      if (!current) throw Object.assign(new Error("This availability window is already withdrawn or could not be found."), { statusCode: 409 });
    }
    await appendFile(path.join(dataDir, "cleaner-availability.ndjson"), `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  });
  writeQueue = operation;
  return operation;
}

async function saveBookingOnce(booking) {
  const operation = writeQueue.catch(() => {}).then(async () => {
    await mkdir(dataDir, { recursive: true });
    const [bookings, availabilityEvents, config, proposals, proposalUpdates, cleanerDecisions] = await Promise.all([
      readRecords("bookings.ndjson"),
      readRecords("cleaner-availability.ndjson"),
      readJsonFile("business-config.json", {}),
      readRecords("match-proposals.ndjson"),
      readRecords("proposal-status.ndjson"),
      readRecords("cleaner-opportunity-decisions.ndjson")
    ]);
    if (bookings.some((item) => item.requestId === booking.requestId || item.proposalId === booking.proposalId)) {
      throw Object.assign(new Error("A booking is already recorded for this request or proposal."), { statusCode: 409 });
    }
    if (!findCleanerAvailabilitySlot(booking.cleanerId, booking, availabilityEvents)) {
      throw Object.assign(new Error("The cleaner's confirmed availability no longer covers this visit."), { statusCode: 409 });
    }
    if (!proposalCostModelCurrent(booking, config)) throw Object.assign(new Error("The proposal cost assumptions changed before booking confirmation."), { statusCode: 409 });
    const capacityConflict = findCleanerLiveCapacityConflict({ ...booking, id: booking.proposalId }, proposals, proposalUpdates, cleanerDecisions, bookings);
    if (capacityConflict) {
      throw Object.assign(new Error(`This cleaner's capacity is already committed to overlapping work (${capacityConflict.id}).`), { statusCode: 409 });
    }
    await appendFile(path.join(dataDir, "bookings.ndjson"), `${JSON.stringify(booking)}\n`, { encoding: "utf8", mode: 0o600 });
  });
  writeQueue = operation;
  return operation;
}

function applyBookingChangeStatus(record, updates) {
  let status = record.status || "open";
  let resolutionNote = "";
  let updatedAt = record.createdAt;
  for (const update of updates) {
    if (update.changeRequestId !== record.id) continue;
    status = update.status;
    resolutionNote = update.note || "";
    updatedAt = update.updatedAt;
  }
  return { ...record, status, resolutionNote, updatedAt };
}

async function saveBookingChangeRequest(record) {
  const operation = writeQueue.catch(() => {}).then(async () => {
    await mkdir(dataDir, { recursive: true });
    const [records, updates] = await Promise.all([
      readRecords("booking-change-requests.ndjson"),
      readRecords("booking-change-status.ndjson")
    ]);
    const sameAudience = records.filter((item) => item.bookingId === record.bookingId && item.audience === record.audience).map((item) => applyBookingChangeStatus(item, updates));
    if (sameAudience.length >= 10) throw Object.assign(new Error("This booking already has ten change or issue requests. Contact Tideway directly."), { statusCode: 409 });
    if (sameAudience.filter((item) => ["open", "reviewing"].includes(item.status)).length >= 3) {
      throw Object.assign(new Error("Three requests are already open for this booking. Wait for Tideway to review them or contact support."), { statusCode: 409 });
    }
    await appendFile(path.join(dataDir, "booking-change-requests.ndjson"), `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  });
  writeQueue = operation;
  return operation;
}

function bookingJobProgress(bookingId, events) {
  const own = events.filter((event) => event.bookingId === bookingId);
  const find = (type) => own.find((event) => event.type === type) || null;
  const arrived = find("cleaner-arrived");
  const cleanerCompleted = find("cleaner-completed");
  const customerCompleted = find("customer-completed");
  return {
    cleanerArrivedAt: arrived?.createdAt || "",
    cleanerCompletedAt: cleanerCompleted?.createdAt || "",
    customerCompletedAt: customerCompleted?.createdAt || "",
    readyForOutcome: Boolean(arrived && cleanerCompleted && customerCompleted)
  };
}

async function saveJobEvent(record) {
  const operation = writeQueue.catch(() => {}).then(async () => {
    await mkdir(dataDir, { recursive: true });
    const [events, changes, changeUpdates] = await Promise.all([
      readRecords("job-events.ndjson"),
      readRecords("booking-change-requests.ndjson"),
      readRecords("booking-change-status.ndjson")
    ]);
    if (events.some((event) => event.bookingId === record.bookingId && event.type === record.type)) {
      throw Object.assign(new Error("This job event has already been recorded."), { statusCode: 409 });
    }
    const progress = bookingJobProgress(record.bookingId, events);
    if (record.type === "cleaner-arrived") {
      const unresolved = changes.filter((change) => change.bookingId === record.bookingId).map((change) => applyBookingChangeStatus(change, changeUpdates)).filter((change) => ["open", "reviewing"].includes(change.status));
      if (unresolved.length) throw Object.assign(new Error("Resolve all open booking change and safety requests before recording job start."), { statusCode: 409 });
    }
    if (record.type === "cleaner-completed" && !progress.cleanerArrivedAt) {
      throw Object.assign(new Error("Record cleaner arrival before completion."), { statusCode: 409 });
    }
    if (record.type === "customer-completed" && !progress.cleanerCompletedAt) {
      throw Object.assign(new Error("Customer completion cannot be recorded before the cleaner finishes."), { statusCode: 409 });
    }
    await appendFile(path.join(dataDir, "job-events.ndjson"), `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
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

const briefRoomAreas = new Set(briefRoomOptions);

function briefScopeSignals(brief) {
  if (!Array.isArray(brief?.scopeSignals)) return detectPriceSensitiveScope(brief || {});
  return normalisePriceSensitiveScopeSignals(brief.scopeSignals);
}

function decodeBriefPhoto(input, index) {
  const area = text(input?.area, 80);
  const note = text(input?.note, 500);
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
  return { id, area, note, mimeType, extension, bytes };
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

function pilotPostcodeCoverage(postcode, configuredPostcodes) {
  const rawCodes = text(configuredPostcodes, 400).toUpperCase().split(/[,;\n]+/).map((code) => code.trim()).filter(Boolean);
  const allowedCodes = [...new Set(rawCodes.map((code) => code.replace(/\s+/g, "")).filter((code) => /^[A-Z]{1,2}\d[A-Z\d]?$/.test(code)))];
  const invalidCodes = rawCodes.filter((code) => !/^[A-Z]{1,2}\d[A-Z\d]?$/.test(code.replace(/\s+/g, "")));
  const compactPostcode = text(postcode, 20).toUpperCase().replace(/\s+/g, "");
  const outwardCode = compactPostcode.length > 3 ? compactPostcode.slice(0, -3) : "";
  return {
    configured: allowedCodes.length > 0,
    outwardCode,
    allowedCodes,
    invalidCodes,
    covered: Boolean(outwardCode && allowedCodes.includes(outwardCode))
  };
}

function jobSchedule(record) {
  const proposedDate = text(record?.proposedDate, 20);
  const proposedStartTime = text(record?.proposedStartTime, 10);
  const estimatedHours = Number(record?.estimatedHours);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(proposedDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(proposedStartTime) || !Number.isFinite(estimatedHours) || estimatedHours <= 0) return null;
  const [year, month, day] = proposedDate.split("-").map(Number);
  const [hour, minute] = proposedStartTime.split(":").map(Number);
  const startMs = Date.UTC(year, month - 1, day, hour, minute);
  const parsed = new Date(startMs);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  const endMs = startMs + estimatedHours * 60 * 60 * 1000;
  const nextDayMs = Date.UTC(year, month - 1, day + 1);
  if (endMs > nextDayMs) return null;
  const end = new Date(endMs);
  const proposedEndTime = `${String(end.getUTCHours()).padStart(2, "0")}:${String(end.getUTCMinutes()).padStart(2, "0")}`;
  return { proposedDate, proposedStartTime, proposedEndTime, startMs, endMs };
}

function availabilitySlotSchedule(record) {
  const availableDate = text(record?.availableDate, 20);
  const startTime = text(record?.startTime, 10);
  const endTime = text(record?.endTime, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(availableDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) return null;
  const [year, month, day] = availableDate.split("-").map(Number);
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  const startMs = Date.UTC(year, month - 1, day, startHour, startMinute);
  const endMs = Date.UTC(year, month - 1, day, endHour, endMinute);
  const parsed = new Date(startMs);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day || endMs <= startMs) return null;
  return { proposedDate: availableDate, proposedStartTime: startTime, proposedEndTime: endTime, startMs, endMs };
}

function activeCleanerAvailability(events, cleanerId = "") {
  const slots = new Map();
  for (const event of events) {
    if (event.action === "confirmed" && availabilitySlotSchedule(event)) slots.set(event.id, { ...event, status: "active" });
    if (event.action === "withdrawn" && slots.has(event.slotId)) slots.set(event.slotId, { ...slots.get(event.slotId), status: "withdrawn", withdrawalNote: event.note, withdrawnAt: event.updatedAt });
  }
  return [...slots.values()].filter((slot) => slot.status === "active" && (!cleanerId || slot.cleanerId === cleanerId)).sort((left, right) => left.availableDate.localeCompare(right.availableDate) || left.startTime.localeCompare(right.startTime));
}

function findCleanerAvailabilitySlot(cleanerId, record, events) {
  const proposed = jobSchedule(record);
  if (!proposed) return null;
  return activeCleanerAvailability(events, cleanerId).find((slot) => {
    const available = availabilitySlotSchedule(slot);
    return available && available.startMs <= proposed.startMs && available.endMs >= proposed.endMs;
  }) || null;
}

const preferredArrivalWindows = {
  "Flexible": null,
  "Morning (8am–12pm)": { startTime: "08:00", endTime: "12:00", label: "morning arrival" },
  "Afternoon (12pm–5pm)": { startTime: "12:00", endTime: "17:00", label: "afternoon arrival" },
  "Evening (5pm–8pm)": { startTime: "17:00", endTime: "20:00", label: "evening arrival" }
};

function utcTimeOnDate(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return NaN;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return Date.UTC(year, month - 1, day, hour, minute);
}

function utcTimeLabel(value) {
  const date = new Date(value);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function schedulableAvailability(slot, customerRequest, requiredHours, nowMs = Date.now(), busyIntervals = []) {
  const schedule = availabilitySlotSchedule(slot);
  if (!schedule || !Number.isFinite(requiredHours) || requiredHours <= 0) return null;
  if (customerRequest.preferredDate && slot.availableDate !== customerRequest.preferredDate) return null;
  const arrivalPreference = customerRequest.preferredTimeWindow || "Flexible";
  if (!Object.hasOwn(preferredArrivalWindows, arrivalPreference)) return null;
  const arrivalWindow = preferredArrivalWindows[arrivalPreference];
  const windowStartMs = arrivalWindow ? utcTimeOnDate(slot.availableDate, arrivalWindow.startTime) : schedule.startMs;
  const windowEndMs = arrivalWindow ? utcTimeOnDate(slot.availableDate, arrivalWindow.endTime) : schedule.endMs;
  const quarterHourMs = 15 * 60 * 1000;
  const earliestBookableMs = Math.ceil((nowMs + quarterHourMs) / quarterHourMs) * quarterHourMs;
  const requiredMs = requiredHours * 60 * 60 * 1000;
  let suggestedStartMs = Math.max(schedule.startMs, windowStartMs, earliestBookableMs);
  let heldIntervalsAvoided = 0;
  const relevantBusyIntervals = busyIntervals
    .filter((interval) => interval.startMs < schedule.endMs && schedule.startMs < interval.endMs)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  for (const interval of relevantBusyIntervals) {
    const suggestedEndMs = suggestedStartMs + requiredMs;
    if (suggestedEndMs <= interval.startMs) break;
    if (suggestedStartMs < interval.endMs && interval.startMs < suggestedEndMs) {
      suggestedStartMs = Math.max(suggestedStartMs, interval.endMs);
      heldIntervalsAvoided += 1;
    }
  }
  const suggestedEndMs = suggestedStartMs + requiredMs;
  if (suggestedStartMs >= windowEndMs || suggestedEndMs > schedule.endMs) return null;
  return {
    id: slot.id,
    availableDate: slot.availableDate,
    startTime: slot.startTime,
    endTime: slot.endTime,
    suggestedStartTime: utcTimeLabel(suggestedStartMs),
    suggestedEndTime: utcTimeLabel(suggestedEndMs),
    requiredHours,
    capacityAdjusted: heldIntervalsAvoided > 0,
    heldIntervalsAvoided,
    arrivalWindowFit: true,
    dateFit: !customerRequest.preferredDate || slot.availableDate === customerRequest.preferredDate
  };
}

function moneyValue(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function costAssumptionsFromConfig(config) {
  return {
    paymentFeePercent: Number(config.paymentFeePercent) || 0,
    paymentFeeFixed: Number(config.paymentFeeFixed) || 0,
    travelCostPerJob: Number(config.travelCostPerJob) || 0,
    suppliesCostPerJob: Number(config.suppliesCostPerJob) || 0,
    riskContingencyPercent: Number(config.riskContingencyPercent) || 0
  };
}

function costAssumptionsConfirmed(config) {
  const costs = costAssumptionsFromConfig(config);
  return config.variableCostsConfirmed === true
    && costs.paymentFeePercent >= 0 && costs.paymentFeePercent <= 20
    && costs.paymentFeeFixed >= 0 && costs.paymentFeeFixed <= 20
    && costs.travelCostPerJob >= 0 && costs.travelCostPerJob <= 200
    && costs.suppliesCostPerJob >= 0 && costs.suppliesCostPerJob <= 200
    && costs.riskContingencyPercent >= 0 && costs.riskContingencyPercent <= 50;
}

function proposalCostModelCurrent(proposal, config) {
  const expected = costAssumptionsFromConfig(config);
  return Boolean(proposal.costAssumptions) && Object.keys(expected).every((key) => Number(proposal.costAssumptions[key]) === expected[key]);
}

function calculateProposalEconomics(estimatedHours, customerRate, cleanerRate, additionalCosts, config) {
  const costAssumptions = costAssumptionsFromConfig(config);
  const customerTotal = moneyValue(estimatedHours * customerRate);
  const cleanerPay = moneyValue(estimatedHours * cleanerRate);
  const paymentFees = moneyValue(customerTotal * costAssumptions.paymentFeePercent / 100 + costAssumptions.paymentFeeFixed);
  const travelCosts = moneyValue(costAssumptions.travelCostPerJob);
  const suppliesCosts = moneyValue(costAssumptions.suppliesCostPerJob);
  const riskContingency = moneyValue(customerTotal * costAssumptions.riskContingencyPercent / 100);
  const otherCosts = moneyValue(additionalCosts);
  const nonCleanerCosts = moneyValue(paymentFees + travelCosts + suppliesCosts + riskContingency + otherCosts);
  const contribution = moneyValue(customerTotal - cleanerPay - nonCleanerCosts);
  const marginPercent = customerTotal > 0 ? (contribution / customerTotal) * 100 : 0;
  return { customerTotal, cleanerPay, paymentFees, travelCosts, suppliesCosts, riskContingency, otherCosts, nonCleanerCosts, contribution, marginPercent, costAssumptions };
}

function schedulesOverlap(left, right) {
  return left.startMs < right.endMs && right.startMs < left.endMs;
}

function proposalLifecycle(proposal, proposalUpdates) {
  let status = proposal.status || "draft";
  let latestUpdate = null;
  let quoteSnapshot = null;
  let cleanerOpportunitySnapshot = null;
  for (const update of proposalUpdates) {
    if (update.proposalId !== proposal.id) continue;
    status = update.status;
    latestUpdate = update;
    if (update.quoteSnapshot) quoteSnapshot = update.quoteSnapshot;
    if (update.cleanerOpportunitySnapshot) cleanerOpportunitySnapshot = update.cleanerOpportunitySnapshot;
  }
  return { status, latestUpdate, quoteSnapshot, cleanerOpportunitySnapshot };
}

function customerDecisionForProposal(proposalId, proposalUpdates) {
  let latest = null;
  for (const update of proposalUpdates) {
    if (update.proposalId === proposalId && update.source === "customer-private-quote") latest = update;
  }
  return latest;
}

function replacementOfferSummary(proposal, proposals, proposalUpdates, currentTerms) {
  if (!proposal.replacesProposalId) return null;
  const previousProposal = proposals.find((record) => record.id === proposal.replacesProposalId);
  if (!previousProposal || previousProposal.requestId !== proposal.requestId) return null;
  const previousLifecycle = proposalLifecycle(previousProposal, proposalUpdates);
  const previousTerms = previousLifecycle.quoteSnapshot;
  const previousDecision = customerDecisionForProposal(previousProposal.id, proposalUpdates);
  const changes = [{ key: "matching", label: "Cleaner matching was run again for this visit." }];
  if (!previousTerms) {
    changes.push({ key: "prior-terms", label: "The previous offer did not have frozen customer terms; review every current detail." });
  } else {
    if (previousTerms.proposedDate !== currentTerms.proposedDate) changes.push({ key: "date", label: "The proposed cleaning date changed." });
    if (previousTerms.proposedStartTime !== currentTerms.proposedStartTime || previousTerms.proposedEndTime !== currentTerms.proposedEndTime) changes.push({ key: "time", label: "The proposed arrival or finish time changed." });
    if (Number(previousTerms.estimatedHours) !== Number(currentTerms.estimatedHours)) changes.push({ key: "duration", label: "The estimated cleaning time changed." });
    if (Number(previousTerms.customerTotal) !== Number(currentTerms.customerTotal)) changes.push({ key: "customer-total", label: "The proposed customer total changed." });
    if (previousTerms.service !== currentTerms.service || previousTerms.siteSize !== currentTerms.siteSize) changes.push({ key: "site-scope", label: "The service or site scope changed." });
    if (JSON.stringify(previousTerms.checklist || []) !== JSON.stringify(currentTerms.checklist || [])) changes.push({ key: "checklist", label: "The cleaner checklist changed; review every task again." });
    if (JSON.stringify(normalisePriceSensitiveScopeSignals(previousTerms.scopeSignals || [])) !== JSON.stringify(normalisePriceSensitiveScopeSignals(currentTerms.scopeSignals || []))) changes.push({ key: "extras", label: "The price-sensitive items included in the quote changed." });
    if (previousTerms.cancellationPolicy !== currentTerms.cancellationPolicy || previousTerms.paymentTiming !== currentTerms.paymentTiming) changes.push({ key: "terms", label: "The cancellation or payment terms changed." });
  }
  return {
    previousReference: previousProposal.id,
    previousStatus: previousLifecycle.status,
    previousCustomerAccepted: previousDecision?.status === "accepted",
    freshCustomerDecisionRequired: true,
    changes
  };
}

function cleanerDecisionForProposal(proposalId, cleanerDecisions) {
  let latest = null;
  for (const decision of cleanerDecisions) if (decision.proposalId === proposalId) latest = decision;
  return latest;
}

function proposalOfferIsExhausted(proposal, proposalUpdates, cleanerDecisions) {
  const { status, quoteSnapshot, cleanerOpportunitySnapshot } = proposalLifecycle(proposal, proposalUpdates);
  const cleanerDecision = cleanerDecisionForProposal(proposal.id, cleanerDecisions);
  if (cleanerDecision?.status === "declined") return true;
  if (status === "sent" && !offerIsOpen(quoteSnapshot?.offerExpiresAt)) return true;
  if (["sent", "accepted"].includes(status) && !cleanerDecision && !offerIsOpen(cleanerOpportunitySnapshot?.offerExpiresAt)) return true;
  return false;
}

function proposalHasLiveOffer(proposal, proposalUpdates, cleanerDecisions) {
  const { status } = proposalLifecycle(proposal, proposalUpdates);
  if (!["ready", "sent", "accepted"].includes(status)) return false;
  return !proposalOfferIsExhausted(proposal, proposalUpdates, cleanerDecisions);
}

function proposalHoldsCleanerCapacity(proposal, proposalUpdates, cleanerDecisions) {
  const { status } = proposalLifecycle(proposal, proposalUpdates);
  return ["sent", "accepted"].includes(status) && !proposalOfferIsExhausted(proposal, proposalUpdates, cleanerDecisions);
}

function fullDaySchedule(date) {
  const startMs = utcTimeOnDate(date, "00:00");
  return Number.isFinite(startMs) ? { startMs, endMs: startMs + 24 * 60 * 60 * 1000 } : null;
}

function cleanerBusyIntervals(cleanerId, proposals, proposalUpdates, cleanerDecisions, bookings, excludeProposalId = "") {
  const intervals = [];
  const bookedProposalIds = new Set(bookings.map((booking) => booking.proposalId));
  for (const proposal of proposals) {
    if (proposal.id === excludeProposalId || proposal.cleanerId !== cleanerId || bookedProposalIds.has(proposal.id)) continue;
    if (!proposalHoldsCleanerCapacity(proposal, proposalUpdates, cleanerDecisions)) continue;
    const schedule = jobSchedule(proposal) || fullDaySchedule(proposal.proposedDate);
    if (schedule) intervals.push({ id: proposal.id, kind: "live-offer", ...schedule });
  }
  for (const booking of bookings) {
    if (booking.proposalId === excludeProposalId || booking.cleanerId !== cleanerId) continue;
    const schedule = jobSchedule(booking) || fullDaySchedule(booking.proposedDate);
    if (schedule) intervals.push({ id: booking.id, kind: "booking", ...schedule });
  }
  return intervals.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
}

function findCleanerLiveCapacityConflict(target, proposals, proposalUpdates, cleanerDecisions, bookings) {
  const targetSchedule = jobSchedule(target);
  if (!targetSchedule) return { id: "invalid-schedule", proposedDate: target.proposedDate };
  return cleanerBusyIntervals(target.cleanerId, proposals, proposalUpdates, cleanerDecisions, bookings, target.id)
    .find((interval) => schedulesOverlap(targetSchedule, interval)) || null;
}

function findCleanerScheduleConflict(target, proposals, proposalUpdates, cleanerDecisions, bookings) {
  const targetSchedule = jobSchedule(target);
  if (!targetSchedule) return { id: "invalid-schedule", proposedDate: target.proposedDate };
  const statuses = new Map(proposals.map((proposal) => [proposal.id, proposal.status || "draft"]));
  for (const update of proposalUpdates) statuses.set(update.proposalId, update.status);
  const acceptedProposalIds = new Set(cleanerDecisions.filter((decision) => decision.status === "accepted").map((decision) => decision.proposalId));
  const bookedProposalIds = new Set(bookings.map((booking) => booking.proposalId));
  for (const other of proposals) {
    if (other.id === target.id || other.cleanerId !== target.cleanerId) continue;
    if (["declined", "cancelled"].includes(statuses.get(other.id))) continue;
    if (!acceptedProposalIds.has(other.id) && !bookedProposalIds.has(other.id)) continue;
    const otherSchedule = jobSchedule(other);
    if (!otherSchedule) {
      if (other.proposedDate === target.proposedDate) return { id: other.id, proposedDate: other.proposedDate };
      continue;
    }
    if (schedulesOverlap(targetSchedule, otherSchedule)) return { id: other.id, ...otherSchedule };
  }
  for (const booking of bookings) {
    if (booking.proposalId === target.id || booking.cleanerId !== target.cleanerId) continue;
    const bookingSchedule = jobSchedule(booking);
    if (!bookingSchedule) {
      if (booking.proposedDate === target.proposedDate) return { id: booking.id, proposedDate: booking.proposedDate };
      continue;
    }
    if (schedulesOverlap(targetSchedule, bookingSchedule)) return { id: booking.id, ...bookingSchedule };
  }
  return null;
}

function launchReadiness(config) {
  const pilotCoverage = pilotPostcodeCoverage("", config.pilotPostcodes);
  const checks = {
    identity: Boolean(config.legalOwnerName && config.businessStructure && config.legalBusinessName && config.tradingAddress),
    contact: Boolean(config.supportEmail && isEmail(config.supportEmail) && config.supportPhone && isPhone(config.supportPhone)),
    pilotArea: pilotCoverage.configured && pilotCoverage.invalidCodes.length === 0,
    economics: Boolean(config.customerHourlyRate > 0 && config.cleanerHourlyPay > 0 && config.minimumHours > 0 && config.minimumContributionMarginPercent > 0 && config.minimumContributionMarginPercent < 100 && config.customerHourlyRate > config.cleanerHourlyPay && costAssumptionsConfirmed(config) && config.minimumContributionMarginPercent + config.paymentFeePercent + config.riskContingencyPercent < 100),
    insurance: config.insuranceStatus === "active",
    payments: Boolean(config.paymentProviderStatus === "live" && config.paymentProviderName && config.refundProcess),
    operatingRules: Boolean(config.cleanerModel && config.cleanerModel !== "Undecided" && config.cancellationPolicy && config.paymentTiming && Number.isInteger(config.customerQuoteValidityHours) && config.customerQuoteValidityHours >= 1 && config.customerQuoteValidityHours <= 168 && Number.isInteger(config.cleanerOpportunityValidityHours) && config.cleanerOpportunityValidityHours >= 1 && config.cleanerOpportunityValidityHours <= 168)
  };
  return { checks, completed: Object.values(checks).filter(Boolean).length, total: Object.keys(checks).length, ready: Object.values(checks).every(Boolean) };
}

function dispatchActionsForRecord({ kind, status, nextActionAt, proposals = [], briefs = [], booking = null, outcome = null, screening = null, cleanerAvailability = [], pilotCoverage = null }) {
  const actions = [];
  const add = (code, severity, group, title, detail) => {
    if (!actions.some((action) => action.code === code)) actions.push({ code, severity, group, title, detail });
  };
  const today = new Date().toISOString().slice(0, 10);
  const closed = ["completed", "lost", "rejected"].includes(status);
  if (!closed && nextActionAt && nextActionAt <= today) add("follow-up-due", "high", "lead", "Follow-up is due", `The recorded next-action date was ${nextActionAt}. Review the lead before making any promise.`);

  if (kind === "cleaner") {
    if (closed || status === "paused") return actions;
    if (status === "new") add("review-cleaner", "high", "supply", "Review new cleaner application", "Check the application without approving, rejecting or contacting the applicant unless the founder authorises that action.");
    else if (["contacted", "screening"].includes(status) && !screening?.complete) add("complete-screening", "high", "supply", "Cleaner screening is incomplete", "Complete the seven recorded checks before approval, matching or availability confirmation.");
    else if (status === "approved" && screening?.complete && cleanerAvailability.length === 0) add("availability-needed", "high", "supply", "Approved cleaner has no confirmed availability", "Record only an explicitly verified future availability window before matching this cleaner.");
    return actions;
  }

  if (booking) {
    const openChanges = booking.changeRequests?.filter((change) => ["open", "reviewing"].includes(change.status)) || [];
    if (openChanges.some((change) => change.type === "safety-issue")) add("safety-review", "urgent", "safety", "Safety report requires review", "Keep job progress and financial completion blocked until the safety report is reviewed and closed with a clear response.");
    else if (openChanges.length) add("booking-change-review", "high", "booking", "Booking change requires review", "Review the protected change queue; submission alone does not cancel, reschedule, refund or alter the booking.");
    if (!outcome && booking.jobProgress?.readyForOutcome && openChanges.length === 0) add("record-economics", "high", "booking", "Completed visit needs actual economics", "Record actual receipts, cleaner pay, fees, travel, supplies, other costs and refunds; this action does not move money.");
    else if (!outcome && booking.jobProgress?.cleanerCompletedAt && !booking.jobProgress?.customerCompletedAt) add("customer-completion-pending", "monitor", "booking", "Customer completion acknowledgement pending", "The cleaner recorded completion; the customer has not yet acknowledged the visit through the protected booking pack.");
    else if (!outcome && booking.proposedDate < today && !booking.jobProgress?.cleanerCompletedAt) add("visit-progress-overdue", "high", "booking", "Visit progress is overdue", "The scheduled date has passed without a cleaner completion event. Review the booking and any incident before recording an outcome.");
    return actions;
  }

  if (closed) return actions;
  if (pilotCoverage?.configured && !pilotCoverage.covered) add("outside-pilot", "high", "matching", "Request is outside the pilot area", "Do not promise coverage. Close the request or obtain an explicit founder decision before changing the configured pilot area.");
  const latestBrief = briefs[0] || null;
  if (!latestBrief) {
    if (status === "new") add("review-request", "high", "scan", "Review new request and room-scan handoff", "Check the request and make sure the customer has the private route to submit required photos and spoken notes.");
    else add("scan-pending", "monitor", "scan", "Required room scan is still pending", "A quote cannot advance until the customer submits photos and spoken notes and Tideway reviews the resulting room-by-room tasks.");
    return actions;
  }
  if (latestBrief.status === "landlord-draft") {
    add("review-scan", "high", "scan", "Room scan is waiting for review", "Review every room photo, concise task, hazards, cleaning-time estimate and scope confidence before matching.");
    return actions;
  }
  if (latestBrief.status === "needs-revision") {
    add("scan-revision-pending", "monitor", "scan", "Revised room scan is pending", "The customer must correct the recorded scope issue before Tideway can prepare another quote.");
    return actions;
  }

  const activeProposal = proposals.find((proposal) => ["accepted", "sent", "ready", "draft"].includes(proposal.status) && !proposal.exhausted);
  const exhaustedProposal = proposals.find((proposal) => ["accepted", "sent"].includes(proposal.status) && proposal.exhausted);
  if (!activeProposal) {
    if (exhaustedProposal) add("rematch", "high", "rematching", "Cleaner rematch and replacement offer required", "The previous offer is no longer actionable. Recheck scope, confirmed availability and economics before issuing one replacement.");
    else add("find-match", "high", "matching", "Reviewed request needs a cleaner match", "Find a fully screened cleaner with confirmed availability before preparing a profitable proposal.");
    return actions;
  }
  if (["ready", "sent", "accepted"].includes(activeProposal.status) && activeProposal.cleanerEligibilityCurrent === false) {
    add("rematch", "high", "rematching", "Cleaner eligibility changed", "The current offer is blocked. Recheck approval, screening, service fit and travel coverage, then select an eligible cleaner before preparing one replacement.");
  } else if (["ready", "sent", "accepted"].includes(activeProposal.status) && !activeProposal.availabilityCovered) {
    add("rematch", "high", "rematching", "Cleaner availability changed", "The current offer is blocked. Select a screened cleaner with a confirmed window and prepare one replacement proposal.");
  } else if (["ready", "sent", "accepted"].includes(activeProposal.status) && !activeProposal.costModelCurrent) {
    add("reprice", "high", "matching", "Proposal needs recalculation", "Founder cost assumptions changed. Prepare a replacement using the current payment, travel, supplies and risk costs.");
  } else if (activeProposal.status === "accepted" && activeProposal.cleanerDecision?.status === "accepted") {
    add("finalise-booking", "high", "booking", "Both sides accepted — run final booking checks", "Confirm address, access, emergency instructions and payment authorisation before recording the protected booking pack.");
  } else if (activeProposal.status === "accepted") {
    add("cleaner-decision-pending", "monitor", "matching", "Cleaner decision is pending", "The customer accepted, but the proposed cleaner must independently confirm scope, pay and availability before booking.");
  } else if (activeProposal.status === "sent") {
    add("offer-responses-pending", "monitor", "matching", "Offer responses are pending", "Monitor the frozen customer and cleaner deadlines. Do not record acceptance on either party's behalf.");
  } else if (activeProposal.status === "ready") {
    add("proposal-ready", "high", "matching", "Reviewed proposal is ready for an approved send", "Check the frozen quote and opportunity before any authorised manual outreach. The control desk does not send them.");
  } else {
    add("review-proposal", "high", "matching", "Draft proposal needs review", "Verify schedule, scope, cleaner availability and contribution margin before marking the proposal ready.");
  }
  return actions;
}

function proposalDispatchPriority(proposal) {
  if (proposal.status === "accepted" && !proposal.exhausted) return 6;
  if (proposal.status === "sent" && !proposal.exhausted) return 5;
  if (proposal.status === "ready") return 4;
  if (proposal.status === "draft") return 3;
  if (["accepted", "sent"].includes(proposal.status) && proposal.exhausted) return 2;
  return 1;
}

function applyBriefStatus(brief, updates) {
  let status = brief.status || "landlord-draft";
  let reviewNote = "";
  let reviewedAt = "";
  let scopeEstimateHours = null;
  let scopeConfidence = "";
  let scopeSignalConfirmations = [];
  for (const update of updates) {
    if (update.briefId !== brief.id) continue;
    status = update.status;
    reviewNote = update.note || "";
    reviewedAt = update.updatedAt;
    scopeEstimateHours = Number.isFinite(update.scopeEstimateHours) ? update.scopeEstimateHours : null;
    scopeConfidence = update.scopeConfidence || "";
    scopeSignalConfirmations = Array.isArray(update.scopeSignalConfirmations) ? update.scopeSignalConfirmations : [];
  }
  const scopeSignals = briefScopeSignals(brief);
  const confirmedCodes = new Set(scopeSignalConfirmations);
  const priceSensitiveScopeConfirmed = scopeSignals.every((signal) => confirmedCodes.has(signal.code));
  return { ...brief, scopeSignals, status, reviewNote, reviewedAt, scopeEstimateHours, scopeConfidence, scopeSignalConfirmations: [...confirmedCodes], priceSensitiveScopeConfirmed };
}

function latestCleanerScreening(cleanerId, screenings) {
  let latest = null;
  for (const screening of screenings) if (screening.cleanerId === cleanerId) latest = screening;
  return latest;
}

function cleanerEligibilityChecks(cleaner, customerRequest, cleanerStatus, screenings) {
  const requiredService = requestServiceMap[customerRequest?.service] || "";
  return {
    cleanerExists: Boolean(cleaner),
    cleanerApproved: cleanerStatus === "approved",
    cleanerScreened: Boolean(cleaner && latestCleanerScreening(cleaner.id, screenings)?.complete === true),
    serviceApproved: Boolean(cleaner && (!requiredService || cleaner.services?.includes(requiredService))),
    cleanerTravelCovered: Boolean(cleaner && cleanerTravelCoverage(cleaner.travelAreas, customerRequest?.postcode || "").covered)
  };
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
  const [requests, cleaners, updates, activities, proposals, proposalUpdates, bookings, outcomes, briefs, briefUpdates, screenings, cleanerDecisions, bookingChanges, bookingChangeUpdates, jobEvents, config, availabilityEvents] = await Promise.all([
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
    readRecords("cleaner-screening.ndjson"),
    readRecords("cleaner-opportunity-decisions.ndjson"),
    readRecords("booking-change-requests.ndjson"),
    readRecords("booking-change-status.ndjson"),
    readRecords("job-events.ndjson"),
    readJsonFile("business-config.json", {}),
    readRecords("cleaner-availability.ndjson")
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
  const latestProposalUpdates = new Map();
  const cleanerDecisionsByProposal = new Map(cleanerDecisions.map((decision) => [decision.proposalId, decision]));
  for (const update of proposalUpdates) latestProposalUpdates.set(update.proposalId, update);
  for (const proposal of proposals) {
    const list = proposalsByRequest.get(proposal.requestId) || [];
    const latestUpdate = latestProposalUpdates.get(proposal.id) || null;
    const lifecycle = proposalLifecycle(proposal, proposalUpdates);
    const previousProposal = proposal.replacesProposalId ? proposals.find((record) => record.id === proposal.replacesProposalId && record.requestId === proposal.requestId) || null : null;
    const previousLifecycle = previousProposal ? proposalLifecycle(previousProposal, proposalUpdates) : null;
    const previousCustomerDecision = previousProposal ? customerDecisionForProposal(previousProposal.id, proposalUpdates) : null;
    const replacement = proposal.replacesProposalId ? lifecycle.quoteSnapshot?.replacement || {
      previousReference: previousProposal?.id || proposal.replacesProposalId,
      previousStatus: previousLifecycle?.status || "missing",
      previousCustomerAccepted: previousCustomerDecision?.status === "accepted",
      freshCustomerDecisionRequired: true,
      changes: []
    } : null;
    const proposalRequest = requests.find((record) => record.id === proposal.requestId) || null;
    const proposalCleaner = cleaners.find((record) => record.id === proposal.cleanerId) || null;
    const cleanerStatus = proposalCleaner ? latestStatuses.get(proposalCleaner.id) || proposalCleaner.status || "new" : "missing";
    const cleanerEligibilityCurrent = Boolean(proposalRequest && Object.values(cleanerEligibilityChecks(proposalCleaner, proposalRequest, cleanerStatus, screenings)).every(Boolean));
    list.push({
      ...proposal,
      status: lifecycle.status,
      statusNote: latestUpdate?.note || "",
      statusUpdatedAt: latestUpdate?.updatedAt || proposal.createdAt,
      quoteExpiresAt: lifecycle.quoteSnapshot?.offerExpiresAt || "",
      cleanerOfferExpiresAt: lifecycle.cleanerOpportunitySnapshot?.offerExpiresAt || "",
      replacement,
      cleanerDecision: cleanerDecisionsByProposal.get(proposal.id) || null,
      cleanerEligibilityCurrent,
      availabilityCovered: Boolean(findCleanerAvailabilitySlot(proposal.cleanerId, proposal, availabilityEvents)),
      costModelCurrent: proposalCostModelCurrent(proposal, config),
      exhausted: proposalOfferIsExhausted(proposal, proposalUpdates, cleanerDecisions)
    });
    proposalsByRequest.set(proposal.requestId, list);
  }
  const bookingsByRequest = new Map();
  const bookingChangesByBooking = new Map();
  for (const change of bookingChanges) {
    const list = bookingChangesByBooking.get(change.bookingId) || [];
    list.push(applyBookingChangeStatus(change, bookingChangeUpdates));
    bookingChangesByBooking.set(change.bookingId, list);
  }
  for (const booking of bookings) {
    const ownEvents = jobEvents.filter((event) => event.bookingId === booking.id).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    bookingsByRequest.set(booking.requestId, { ...booking, changeRequests: (bookingChangesByBooking.get(booking.id) || []).sort((left, right) => right.createdAt.localeCompare(left.createdAt)), jobEvents: ownEvents, jobProgress: bookingJobProgress(booking.id, jobEvents) });
  }
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
    const leadProposals = (proposalsByRequest.get(record.id) || []).sort((left, right) => proposalDispatchPriority(right) - proposalDispatchPriority(left) || right.createdAt.localeCompare(left.createdAt));
    const booking = kind === "request" ? bookingsByRequest.get(record.id) || null : null;
    const outcome = booking ? outcomesByBooking.get(booking.id) || null : null;
    const leadBriefs = kind === "request" ? (briefsByRequest.get(record.id) || []).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 5) : [];
    const screening = kind === "cleaner" ? latestCleanerScreening(record.id, screenings) : null;
    const cleanerAvailability = kind === "cleaner" ? activeCleanerAvailability(availabilityEvents, record.id).filter((slot) => availabilitySlotSchedule(slot)?.endMs > Date.now()) : [];
    const pilotCoverage = kind === "request" ? pilotPostcodeCoverage(record.postcode, config.pilotPostcodes) : null;
    const status = latestStatuses.get(record.id) || record.status || "new";
    const nextActionAt = leadActivities.find((activity) => activity.nextActionAt)?.nextActionAt || "";
    const dispatchActions = dispatchActionsForRecord({ kind, status, nextActionAt, proposals: leadProposals, briefs: leadBriefs, booking, outcome, screening, cleanerAvailability, pilotCoverage });
    return { ...record, kind, status, activities: leadActivities.slice(0, 10), nextActionAt, proposals: leadProposals.slice(0, 5), briefs: leadBriefs, screening, cleanerAvailability, pilotCoverage, booking, outcome, dispatchActions };
  };
  const records = [
    ...requests.map((record) => merge(record, "request")),
    ...cleaners.map((record) => merge(record, "cleaner"))
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const dispatchActions = records.flatMap((record) => record.dispatchActions.map((action) => ({ ...action, recordId: record.id, kind: record.kind })));
  return json(response, 200, { ok: true, records, dispatchSummary: { urgent: dispatchActions.filter((action) => action.severity === "urgent").length, high: dispatchActions.filter((action) => action.severity === "high").length, monitor: dispatchActions.filter((action) => action.severity === "monitor").length, total: dispatchActions.length } });
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

async function createAdminCleanerAvailability(request, response) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  ensureSameOrigin(request);
  const input = await readJson(request);
  const cleanerId = text(input.cleanerId, 40);
  const availableDate = text(input.availableDate, 20);
  const startTime = text(input.startTime, 10);
  const endTime = text(input.endTime, 10);
  const confirmationNote = text(input.confirmationNote, 500);
  const schedule = availabilitySlotSchedule({ availableDate, startTime, endTime });
  if (!schedule || schedule.endMs <= Date.now()) return json(response, 422, { ok: false, error: "Add a valid future availability window with an end time after its start time." });
  if (confirmationNote.length < 10) return json(response, 422, { ok: false, error: "Add a confirmation note of at least 10 characters explaining how this availability was verified." });
  const [cleaners, updates, screenings] = await Promise.all([
    readRecords("cleaner-applications.ndjson"),
    readRecords("status-updates.ndjson"),
    readRecords("cleaner-screening.ndjson")
  ]);
  const cleaner = cleaners.find((record) => record.id === cleanerId);
  if (!cleaner) return json(response, 404, { ok: false, error: "Cleaner application not found." });
  let cleanerStatus = cleaner.status || "new";
  for (const update of updates) if (update.id === cleanerId) cleanerStatus = update.status;
  if (cleanerStatus !== "approved" || !latestCleanerScreening(cleanerId, screenings)?.complete) {
    return json(response, 422, { ok: false, error: "Only a fully screened, approved cleaner can receive confirmed availability windows." });
  }
  const slot = { id: `AVL-${randomUUID().slice(0, 8).toUpperCase()}`, cleanerId, action: "confirmed", status: "active", availableDate, startTime, endTime, confirmationNote, createdAt: new Date().toISOString() };
  await saveCleanerAvailabilityEvent(slot);
  return json(response, 201, { ok: true, slot });
}

async function withdrawAdminCleanerAvailability(request, response) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  ensureSameOrigin(request);
  const input = await readJson(request);
  const cleanerId = text(input.cleanerId, 40);
  const slotId = text(input.slotId, 40);
  const note = text(input.note, 500);
  if (!cleanerId || !slotId) return json(response, 422, { ok: false, error: "Cleaner and availability window are required." });
  if (note.length < 10) return json(response, 422, { ok: false, error: "Add a withdrawal note of at least 10 characters." });
  const event = { slotId, cleanerId, action: "withdrawn", status: "withdrawn", note, updatedAt: new Date().toISOString() };
  await saveCleanerAvailabilityEvent(event);
  return json(response, 200, { ok: true, slotId, status: "withdrawn", updatedAt: event.updatedAt });
}

async function updateAdminJobBriefStatus(request, response) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  ensureSameOrigin(request);
  const input = await readJson(request);
  const briefId = text(input.briefId, 40);
  const status = text(input.status, 30);
  const note = text(input.note, 1000);
  const rawScopeEstimateHours = Number(input.scopeEstimateHours);
  const scopeEstimateHours = Number.isFinite(rawScopeEstimateHours) ? Math.round(rawScopeEstimateHours * 4) / 4 : null;
  const scopeConfidence = text(input.scopeConfidence, 20).toLowerCase();
  const suppliedScopeSignalConfirmations = Array.isArray(input.scopeSignalConfirmations) ? input.scopeSignalConfirmations.map((code) => text(code, 50)) : [];
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
  if (status === "reviewed" && (!Number.isFinite(scopeEstimateHours) || scopeEstimateHours < 0.5 || scopeEstimateHours > 24)) {
    return json(response, 422, { ok: false, error: "Add a reviewed cleaning-time estimate between 0.5 and 24 hours." });
  }
  if (status === "reviewed" && !["medium", "high"].includes(scopeConfidence)) {
    return json(response, 422, { ok: false, error: "Choose medium or high scope confidence. Request a revised scan when confidence is low." });
  }
  if (status === "reviewed" && note.length < 10) {
    return json(response, 422, { ok: false, error: "Add a short review note explaining the scope estimate." });
  }
  if (status === "reviewed" && brief.customerScopeConfirmed !== true) {
    return json(response, 422, { ok: false, error: "The customer must confirm that the final concise checklist includes every task they want quoted before this scan can be approved." });
  }
  const scopeSignals = briefScopeSignals(brief);
  const scopeSignalCodes = new Set(scopeSignals.map((signal) => signal.code));
  const scopeSignalConfirmations = [...new Set(suppliedScopeSignalConfirmations.filter((code) => scopeSignalCodes.has(code)))];
  const unconfirmedSignals = scopeSignals.filter((signal) => !scopeSignalConfirmations.includes(signal.code));
  if (status === "reviewed" && unconfirmedSignals.length) {
    return json(response, 422, { ok: false, error: `Confirm that the reviewed cleaning hours include: ${unconfirmedSignals.map((signal) => signal.label).join(", ")}. Otherwise request a revised scan.` });
  }
  const update = { briefId, requestId: brief.requestId, status, previousStatus: currentStatus, note, scopeEstimateHours: status === "reviewed" ? scopeEstimateHours : null, scopeConfidence: status === "reviewed" ? scopeConfidence : "", scopeSignalConfirmations: status === "reviewed" ? scopeSignalConfirmations : [], updatedAt: new Date().toISOString() };
  await saveRecord("job-brief-status.ndjson", update);
  return json(response, 200, { ok: true, briefId, status, reviewNote: note, scopeEstimateHours: update.scopeEstimateHours, scopeConfidence: update.scopeConfidence, scopeSignals, scopeSignalConfirmations: update.scopeSignalConfirmations, reviewedAt: update.updatedAt });
}

async function updateAdminProposalStatus(request, response) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  ensureSameOrigin(request);
  const input = await readJson(request);
  const proposalId = text(input.proposalId, 40);
  const status = text(input.status, 30);
  const note = text(input.note, 500);
  const transitions = {
    draft: new Set(["ready", "cancelled"]),
    ready: new Set(["draft", "sent", "cancelled"]),
    sent: new Set(["cancelled"]),
    accepted: new Set(["cancelled"]),
    declined: new Set([]),
    cancelled: new Set([])
  };
  const [proposals, updates, config, briefs, briefUpdates, customerRequests, cleaners, cleanerUpdates, screenings, cleanerDecisions, bookings, availabilityEvents] = await Promise.all([
    readRecords("match-proposals.ndjson"),
    readRecords("proposal-status.ndjson"),
    readJsonFile("business-config.json", {}),
    readRecords("job-briefs.ndjson"),
    readRecords("job-brief-status.ndjson"),
    readRecords("cleaning-requests.ndjson"),
    readRecords("cleaner-applications.ndjson"),
    readRecords("status-updates.ndjson"),
    readRecords("cleaner-screening.ndjson"),
    readRecords("cleaner-opportunity-decisions.ndjson"),
    readRecords("bookings.ndjson"),
    readRecords("cleaner-availability.ndjson")
  ]);
  const proposal = proposals.find((record) => record.id === proposalId);
  if (!proposal) return json(response, 404, { ok: false, error: "Proposal not found." });
  let currentStatus = proposal.status || "draft";
  for (const update of updates) if (update.proposalId === proposalId) currentStatus = update.status;
  if (!transitions[currentStatus]?.has(status)) return json(response, 422, { ok: false, error: `Proposal cannot move from ${currentStatus} to ${status}.` });
  if (status === "cancelled" && note.length < 10) {
    return json(response, 422, { ok: false, error: "Add a withdrawal reason of at least 10 characters so the decision is auditable." });
  }
  if (status === "cancelled" && bookings.some((booking) => booking.proposalId === proposalId)) {
    return json(response, 409, { ok: false, error: "A confirmed booking cannot be withdrawn through proposal controls. Use the booking change and safety workflow." });
  }
  if (["ready", "sent"].includes(status)) {
    const competingProposal = proposals.find((candidate) => candidate.id !== proposal.id && candidate.requestId === proposal.requestId && proposalHasLiveOffer(candidate, updates, cleanerDecisions));
    if (competingProposal) {
      return json(response, 409, { ok: false, error: `Close or exhaust the existing live proposal ${competingProposal.id} before advancing another offer for this request.` });
    }
  }
  if (["ready", "sent", "accepted"].includes(status) && !launchReadiness(config).ready) {
    return json(response, 422, { ok: false, error: "Complete all seven launch-readiness checks before advancing this proposal." });
  }
  const customerRequest = customerRequests.find((record) => record.id === proposal.requestId);
  const cleaner = cleaners.find((record) => record.id === proposal.cleanerId);
  if (!customerRequest || !cleaner) return json(response, 404, { ok: false, error: "Proposal parties were not found." });
  let cleanerStatus = cleaner.status || "new";
  for (const update of cleanerUpdates) if (update.id === cleaner.id) cleanerStatus = update.status;
  const requiredService = requestServiceMap[customerRequest.service] || "";
  if (["ready", "sent"].includes(status) && cleanerStatus !== "approved") {
    return json(response, 422, { ok: false, error: "The proposed cleaner must still be approved before this proposal can advance." });
  }
  if (["ready", "sent"].includes(status) && !latestCleanerScreening(cleaner.id, screenings)?.complete) {
    return json(response, 422, { ok: false, error: "The proposed cleaner's screening checklist must still be complete." });
  }
  if (["ready", "sent"].includes(status) && requiredService && !cleaner.services?.includes(requiredService)) {
    return json(response, 422, { ok: false, error: "The proposed cleaner is not approved for this service." });
  }
  if (["ready", "sent", "accepted"].includes(status) && !cleanerTravelCoverage(cleaner.travelAreas, customerRequest.postcode).covered) {
    return json(response, 422, { ok: false, error: "The proposed cleaner's stated travel areas no longer cover the customer postcode." });
  }
  if (["ready", "sent"].includes(status) && !findCleanerAvailabilitySlot(cleaner.id, proposal, availabilityEvents)) {
    return json(response, 422, { ok: false, error: "The proposed visit is not fully covered by an active, confirmed cleaner availability window." });
  }
  const pilotCoverage = pilotPostcodeCoverage(customerRequest.postcode, config.pilotPostcodes);
  if (["ready", "sent", "accepted"].includes(status) && !pilotCoverage.covered) {
    return json(response, 422, { ok: false, error: `${pilotCoverage.outwardCode || "This postcode"} is outside the configured Tideway pilot area.` });
  }
  const latestBrief = briefs.filter((brief) => brief.requestId === proposal.requestId).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] || null;
  const reviewedBrief = latestBrief ? applyBriefStatus(latestBrief, briefUpdates) : null;
  if (["ready", "sent", "accepted"].includes(status) && (!reviewedBrief || reviewedBrief.status !== "reviewed")) {
    return json(response, 422, { ok: false, error: "A completed and reviewed room scan is required before advancing this proposal." });
  }
  if (["ready", "sent", "accepted"].includes(status) && reviewedBrief.customerScopeConfirmed !== true) {
    return json(response, 422, { ok: false, error: "The customer must confirm the final concise checklist before advancing this proposal." });
  }
  if (["ready", "sent", "accepted"].includes(status) && !reviewedBrief.priceSensitiveScopeConfirmed) {
    return json(response, 422, { ok: false, error: "Every price-sensitive item detected in the room scan must be confirmed inside the reviewed cleaning-time estimate." });
  }
  if (["ready", "sent", "accepted"].includes(status) && (!Number.isFinite(reviewedBrief.scopeEstimateHours) || proposal.estimatedHours < reviewedBrief.scopeEstimateHours)) {
    const reviewedHours = Number.isFinite(reviewedBrief.scopeEstimateHours) ? `${reviewedBrief.scopeEstimateHours} hours` : "a recorded scope estimate";
    return json(response, 422, { ok: false, error: `This proposal must allow at least ${reviewedHours} from the reviewed room scan.` });
  }
  if (["ready", "sent", "accepted"].includes(status) && proposal.estimatedHours < config.minimumHours) {
    return json(response, 422, { ok: false, error: `This proposal's ${proposal.estimatedHours} estimated hours are below the ${config.minimumHours}-hour minimum.` });
  }
  if (["ready", "sent", "accepted"].includes(status) && (!Number.isFinite(proposal.marginPercent) || proposal.marginPercent < config.minimumContributionMarginPercent)) {
    const proposalMargin = Number.isFinite(proposal.marginPercent) ? `${proposal.marginPercent.toFixed(1)}%` : "unrecorded";
    return json(response, 422, { ok: false, error: `This proposal's ${proposalMargin} contribution margin is below the ${config.minimumContributionMarginPercent.toFixed(1)}% minimum.` });
  }
  if (["ready", "sent"].includes(status) && !proposalCostModelCurrent(proposal, config)) {
    return json(response, 422, { ok: false, error: "The founder cost assumptions changed after this proposal was calculated. Prepare a new proposal with the current payment, travel, supplies and risk costs." });
  }
  const scheduleConflict = findCleanerScheduleConflict(proposal, proposals, updates, cleanerDecisions, bookings);
  if (["ready", "sent"].includes(status) && scheduleConflict) {
    return json(response, 422, { ok: false, error: `The selected cleaner already has accepted work that overlaps this proposed time (${scheduleConflict.id}).` });
  }
  const updatedAt = new Date().toISOString();
  const schedule = jobSchedule(proposal);
  if (status === "sent" && (!schedule || schedule.startMs <= Date.parse(updatedAt))) {
    return json(response, 422, { ok: false, error: "The proposed visit must start in the future before these offers can be sent." });
  }
  const customerOfferExpiresAt = status === "sent" ? offerDeadline(updatedAt, config.customerQuoteValidityHours, schedule.startMs) : "";
  const cleanerOfferExpiresAt = status === "sent" ? offerDeadline(updatedAt, config.cleanerOpportunityValidityHours, schedule.startMs) : "";
  if (status === "sent" && (!customerOfferExpiresAt || !cleanerOfferExpiresAt)) {
    return json(response, 422, { ok: false, error: "Set valid customer and cleaner response windows before sending these offers." });
  }
  const frozenQuoteTerms = status === "sent" ? {
    service: customerRequest.service,
    postcode: customerRequest.postcode,
    siteSize: customerRequest.siteSize,
    proposedDate: proposal.proposedDate,
    proposedStartTime: proposal.proposedStartTime,
    proposedEndTime: proposal.proposedEndTime,
    estimatedHours: proposal.estimatedHours,
    customerTotal: proposal.customerTotal,
    checklist: reviewedBrief?.status === "reviewed" ? reviewedBrief.checklist : [],
    scopeSignals: reviewedBrief?.status === "reviewed" ? reviewedBrief.scopeSignals : [],
    cancellationPolicy: config.cancellationPolicy,
    paymentTiming: config.paymentTiming,
    legalBusinessName: config.legalBusinessName,
    supportEmail: config.supportEmail,
    supportPhone: config.supportPhone,
    offerExpiresAt: customerOfferExpiresAt
  } : null;
  const replacement = frozenQuoteTerms ? replacementOfferSummary(proposal, proposals, updates, frozenQuoteTerms) : null;
  if (status === "sent" && proposal.replacesProposalId && !replacement) {
    return json(response, 409, { ok: false, error: "The replacement offer has no valid predecessor and cannot be sent." });
  }
  const update = {
    proposalId,
    requestId: proposal.requestId,
    status,
    previousStatus: currentStatus,
    note: status === "cancelled" ? note : "",
    ...(status === "sent" ? {
      quoteSnapshot: { ...frozenQuoteTerms, replacement },
      cleanerOpportunitySnapshot: {
        cleanerName: cleaner.fullName,
        service: customerRequest.service,
        area: pilotCoverage.outwardCode,
        siteSize: customerRequest.siteSize,
        hazards: customerRequest.hazards,
        proposedDate: proposal.proposedDate,
        proposedStartTime: proposal.proposedStartTime,
        proposedEndTime: proposal.proposedEndTime,
        estimatedHours: proposal.estimatedHours,
        cleanerPay: proposal.cleanerPay,
        cleanerRate: proposal.cleanerRate,
        checklist: reviewedBrief?.status === "reviewed" ? reviewedBrief.checklist : [],
        scopeSignals: reviewedBrief?.status === "reviewed" ? reviewedBrief.scopeSignals : [],
        photoCount: reviewedBrief?.status === "reviewed" ? reviewedBrief.photos.length : 0,
        photoSharingConsent: reviewedBrief?.status === "reviewed" && reviewedBrief.cleanerPhotoSharingConsent === true,
        roomScanBriefId: reviewedBrief?.status === "reviewed" && reviewedBrief.cleanerPhotoSharingConsent === true ? reviewedBrief.id : "",
        roomPhotos: reviewedBrief?.status === "reviewed" && reviewedBrief.cleanerPhotoSharingConsent === true ? reviewedBrief.photos.map(({ id, area, note }) => ({ id, area, note })) : [],
        cleanerModel: config.cleanerModel,
        legalBusinessName: config.legalBusinessName,
        supportEmail: config.supportEmail,
        supportPhone: config.supportPhone,
        offerExpiresAt: cleanerOfferExpiresAt
      }
    } : {}),
    updatedAt
  };
  await saveProposalStatusOnce(update);
  return json(response, 200, { ok: true, proposalId, status, note: update.note, updatedAt });
}

async function getQuoteContext(token) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return { ok: false, statusCode: 404, error: "This private quote link is invalid." };
  const [proposals, proposalUpdates, customerRequests, cleaners, cleanerUpdates, screenings, cleanerDecisions, bookings, config, briefs, briefUpdates, availabilityEvents] = await Promise.all([
    readRecords("match-proposals.ndjson"),
    readRecords("proposal-status.ndjson"),
    readRecords("cleaning-requests.ndjson"),
    readRecords("cleaner-applications.ndjson"),
    readRecords("status-updates.ndjson"),
    readRecords("cleaner-screening.ndjson"),
    readRecords("cleaner-opportunity-decisions.ndjson"),
    readRecords("bookings.ndjson"),
    readJsonFile("business-config.json", {}),
    readRecords("job-briefs.ndjson"),
    readRecords("job-brief-status.ndjson"),
    readRecords("cleaner-availability.ndjson")
  ]);
  const proposal = proposals.find((record) => record.reviewToken === token);
  if (!proposal) return { ok: false, statusCode: 404, error: "This private quote link is invalid." };
  const customerRequest = customerRequests.find((record) => record.id === proposal.requestId);
  const cleaner = cleaners.find((record) => record.id === proposal.cleanerId);
  if (!customerRequest || !cleaner) return { ok: false, statusCode: 404, error: "The cleaning proposal could not be found." };
  let proposalStatus = proposal.status || "draft";
  let latestDecision = null;
  let quoteSnapshot = null;
  let cleanerOpportunitySnapshot = null;
  for (const update of proposalUpdates) {
    if (update.proposalId !== proposal.id) continue;
    proposalStatus = update.status;
    if (update.quoteSnapshot) quoteSnapshot = update.quoteSnapshot;
    if (update.cleanerOpportunitySnapshot) cleanerOpportunitySnapshot = update.cleanerOpportunitySnapshot;
    if (update.source === "customer-private-quote") latestDecision = update;
  }
  if (proposalStatus === "draft") return { ok: false, statusCode: 409, error: "This quote is still being prepared." };
  const rawLatestBrief = briefs.filter((brief) => brief.requestId === customerRequest.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] || null;
  const latestBrief = rawLatestBrief ? applyBriefStatus(rawLatestBrief, briefUpdates) : null;
  let cleanerStatus = cleaner.status || "new";
  for (const update of cleanerUpdates) if (update.id === cleaner.id) cleanerStatus = update.status;
  const requiredService = requestServiceMap[customerRequest.service] || "";
  const readyChecks = {
    launchReady: launchReadiness(config).ready,
    cleanerApproved: cleanerStatus === "approved",
    cleanerScreened: latestCleanerScreening(cleaner.id, screenings)?.complete === true,
    serviceApproved: !requiredService || cleaner.services?.includes(requiredService),
    cleanerTravelCovered: cleanerTravelCoverage(cleaner.travelAreas, customerRequest.postcode).covered,
    availabilityCovered: Boolean(findCleanerAvailabilitySlot(cleaner.id, proposal, availabilityEvents)),
    costModelCurrent: proposalCostModelCurrent(proposal, config),
    pilotAreaCovered: pilotPostcodeCoverage(customerRequest.postcode, config.pilotPostcodes).covered,
    briefReviewed: Boolean(latestBrief && latestBrief.status === "reviewed"),
    customerScopeConfirmed: latestBrief?.customerScopeConfirmed === true,
    priceSensitiveScopeConfirmed: Boolean(latestBrief?.priceSensitiveScopeConfirmed),
    scanHoursCovered: Boolean(latestBrief && Number.isFinite(latestBrief.scopeEstimateHours) && proposal.estimatedHours >= latestBrief.scopeEstimateHours),
    profitable: proposal.contribution > 0,
    marginFloorMet: config.minimumContributionMarginPercent > 0 && proposal.marginPercent >= config.minimumContributionMarginPercent,
    minimumHoursMet: config.minimumHours > 0 && proposal.estimatedHours >= config.minimumHours,
    scheduleConflictFree: !findCleanerScheduleConflict(proposal, proposals, proposalUpdates, cleanerDecisions, bookings)
  };
  const cleanerDecision = cleanerDecisionForProposal(proposal.id, cleanerDecisions);
  const cleanerOfferClosed = ["sent", "accepted"].includes(proposalStatus) && !cleanerDecision && !offerIsOpen(cleanerOpportunitySnapshot?.offerExpiresAt);
  const previewTerms = quoteSnapshot || {
    service: customerRequest.service,
    postcode: customerRequest.postcode,
    siteSize: customerRequest.siteSize,
    proposedDate: proposal.proposedDate,
    proposedStartTime: proposal.proposedStartTime,
    proposedEndTime: proposal.proposedEndTime,
    estimatedHours: proposal.estimatedHours,
    customerTotal: proposal.customerTotal,
    checklist: latestBrief?.status === "reviewed" ? latestBrief.checklist : [],
    scopeSignals: latestBrief?.status === "reviewed" ? latestBrief.scopeSignals : [],
    cancellationPolicy: config.cancellationPolicy,
    paymentTiming: config.paymentTiming
  };
  const replacement = quoteSnapshot?.replacement || replacementOfferSummary(proposal, proposals, proposalUpdates, previewTerms);
  return { ok: true, proposal, proposalStatus, customerRequest, config, latestBrief, latestDecision, cleanerDecision, cleanerOfferClosed, quoteSnapshot, replacement, readyChecks };
}

function publicQuote(context) {
  const { proposal, proposalStatus, customerRequest, config, latestBrief, latestDecision, cleanerDecision, cleanerOfferClosed, quoteSnapshot, replacement, readyChecks } = context;
  const displayed = quoteSnapshot || {
    service: customerRequest.service,
    postcode: customerRequest.postcode,
    siteSize: customerRequest.siteSize,
    proposedDate: proposal.proposedDate,
    proposedStartTime: proposal.proposedStartTime,
    proposedEndTime: proposal.proposedEndTime,
    estimatedHours: proposal.estimatedHours,
    customerTotal: proposal.customerTotal,
    checklist: latestBrief?.status === "reviewed" ? latestBrief.checklist : [],
    scopeSignals: latestBrief?.status === "reviewed" ? latestBrief.scopeSignals : [],
    cancellationPolicy: config.cancellationPolicy,
    paymentTiming: config.paymentTiming,
    legalBusinessName: config.legalBusinessName,
    supportEmail: config.supportEmail,
    supportPhone: config.supportPhone
  };
  return {
    ok: true,
    quote: {
      reference: proposal.id,
      status: proposalStatus,
      customerName: customerRequest.contactName,
      service: displayed.service,
      postcode: displayed.postcode,
      siteSize: displayed.siteSize,
      preferredDate: customerRequest.preferredDate,
      proposedDate: displayed.proposedDate,
      proposedStartTime: displayed.proposedStartTime,
      proposedEndTime: displayed.proposedEndTime,
      estimatedHours: displayed.estimatedHours,
      customerTotal: displayed.customerTotal,
      cancellationPolicy: displayed.cancellationPolicy,
      paymentTiming: displayed.paymentTiming,
      supportEmail: displayed.supportEmail,
      supportPhone: displayed.supportPhone,
      legalBusinessName: displayed.legalBusinessName,
      replacement: displayed.replacement || replacement || null,
      offerExpiresAt: displayed.offerExpiresAt || "",
      expired: proposalStatus === "sent" && !offerIsOpen(displayed.offerExpiresAt),
      availabilityChanged: proposalStatus === "sent" && !readyChecks.availabilityCovered,
      pricingChanged: proposalStatus === "sent" && !readyChecks.costModelCurrent,
      cleanerDeclined: cleanerDecision?.status === "declined",
      cleanerOfferClosed,
      checklist: displayed.checklist || [],
      confirmedExtras: Array.isArray(displayed.scopeSignals) ? displayed.scopeSignals : [],
      decisionAllowed: proposalStatus === "sent" && cleanerDecision?.status !== "declined" && !cleanerOfferClosed && offerIsOpen(displayed.offerExpiresAt) && Object.values(readyChecks).every(Boolean),
      decision: latestDecision ? { status: latestDecision.status, decidedAt: latestDecision.updatedAt, typedName: latestDecision.typedName } : null
    }
  };
}

async function getPrivateQuote(request, response) {
  const token = text(request.headers["x-quote-token"], 80);
  const context = await getQuoteContext(token);
  if (!context.ok) return json(response, context.statusCode, { ok: false, error: context.error });
  return json(response, 200, publicQuote(context));
}

async function decidePrivateQuote(request, response) {
  ensureSameOrigin(request);
  const token = text(request.headers["x-quote-token"], 80);
  const input = await readJson(request);
  const context = await getQuoteContext(token);
  if (!context.ok) return json(response, context.statusCode, { ok: false, error: context.error });
  if (context.proposalStatus !== "sent") return json(response, 409, { ok: false, error: "This quote is not awaiting a decision." });
  if (context.cleanerDecision?.status === "declined") return json(response, 409, { ok: false, error: "The proposed cleaner is no longer available. Tideway must prepare a replacement proposal." });
  if (context.cleanerOfferClosed) return json(response, 409, { ok: false, error: "The cleaner response window has ended. Tideway must prepare a replacement proposal." });
  if (!offerIsOpen(context.quoteSnapshot?.offerExpiresAt)) return json(response, 409, { ok: false, error: "This quote's response window has ended. Tideway must review and issue a new proposal." });
  if (!Object.values(context.readyChecks).every(Boolean)) return json(response, 409, { ok: false, error: "This quote changed and must be reviewed by Tideway before you decide." });

  const decision = text(input.decision, 20);
  const typedName = text(input.typedName, 120);
  const normalisedName = (value) => value.toLocaleLowerCase("en-GB").replace(/\s+/g, " ").trim();
  if (!["accepted", "declined"].includes(decision)) return json(response, 422, { ok: false, error: "Choose whether to accept or decline this quote." });
  if (!typedName || normalisedName(typedName) !== normalisedName(context.customerRequest.contactName)) {
    return json(response, 422, { ok: false, error: "Type the same contact name used on the cleaning request." });
  }
  if (decision === "accepted" && (input.scopeConfirmed !== true || input.termsAccepted !== true)) {
    return json(response, 422, { ok: false, error: "Confirm the scope and pilot terms before accepting." });
  }

  const updatedAt = new Date().toISOString();
  const update = {
    proposalId: context.proposal.id,
    requestId: context.proposal.requestId,
    status: decision,
    previousStatus: context.proposalStatus,
    source: "customer-private-quote",
    typedName,
    scopeConfirmed: decision === "accepted",
    termsAccepted: decision === "accepted",
    reason: text(input.reason, 500),
    acceptedSnapshot: decision === "accepted" ? (context.quoteSnapshot || {
      service: context.customerRequest.service,
      postcode: context.customerRequest.postcode,
      siteSize: context.customerRequest.siteSize,
      proposedDate: context.proposal.proposedDate,
      proposedStartTime: context.proposal.proposedStartTime,
      proposedEndTime: context.proposal.proposedEndTime,
      estimatedHours: context.proposal.estimatedHours,
      customerTotal: context.proposal.customerTotal,
      checklist: context.latestBrief?.status === "reviewed" ? context.latestBrief.checklist : [],
      scopeSignals: context.latestBrief?.status === "reviewed" ? context.latestBrief.scopeSignals : [],
      cancellationPolicy: context.config.cancellationPolicy,
      paymentTiming: context.config.paymentTiming,
      legalBusinessName: context.config.legalBusinessName,
      supportEmail: context.config.supportEmail,
      supportPhone: context.config.supportPhone,
      offerExpiresAt: context.quoteSnapshot?.offerExpiresAt || ""
    }) : null,
    updatedAt
  };
  await saveDecisionOnce("proposal-status.ndjson", context.proposal.id, update);
  return json(response, 200, { ok: true, status: decision, decidedAt: updatedAt });
}

async function getCleanerOpportunityContext(token) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return { ok: false, statusCode: 404, error: "This private opportunity link is invalid." };
  const [proposals, proposalUpdates, decisions, bookings, customerRequests, cleaners, cleanerUpdates, screenings, config, briefs, briefUpdates, availabilityEvents] = await Promise.all([
    readRecords("match-proposals.ndjson"),
    readRecords("proposal-status.ndjson"),
    readRecords("cleaner-opportunity-decisions.ndjson"),
    readRecords("bookings.ndjson"),
    readRecords("cleaning-requests.ndjson"),
    readRecords("cleaner-applications.ndjson"),
    readRecords("status-updates.ndjson"),
    readRecords("cleaner-screening.ndjson"),
    readJsonFile("business-config.json", {}),
    readRecords("job-briefs.ndjson"),
    readRecords("job-brief-status.ndjson"),
    readRecords("cleaner-availability.ndjson")
  ]);
  const proposal = proposals.find((record) => record.cleanerReviewToken === token);
  if (!proposal) return { ok: false, statusCode: 404, error: "This private opportunity link is invalid." };
  const customerRequest = customerRequests.find((record) => record.id === proposal.requestId);
  const cleaner = cleaners.find((record) => record.id === proposal.cleanerId);
  if (!customerRequest || !cleaner) return { ok: false, statusCode: 404, error: "The cleaning opportunity could not be found." };
  let proposalStatus = proposal.status || "draft";
  let opportunitySnapshot = null;
  for (const update of proposalUpdates) {
    if (update.proposalId !== proposal.id) continue;
    proposalStatus = update.status;
    if (update.cleanerOpportunitySnapshot) opportunitySnapshot = update.cleanerOpportunitySnapshot;
  }
  if (proposalStatus === "draft") return { ok: false, statusCode: 409, error: "This opportunity is still being prepared." };
  let cleanerStatus = cleaner.status || "new";
  for (const update of cleanerUpdates) if (update.id === cleaner.id) cleanerStatus = update.status;
  const rawLatestBrief = briefs.filter((brief) => brief.requestId === customerRequest.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] || null;
  const latestBrief = rawLatestBrief ? applyBriefStatus(rawLatestBrief, briefUpdates) : null;
  const requiredService = requestServiceMap[customerRequest.service] || "";
  const readyChecks = {
    launchReady: launchReadiness(config).ready,
    cleanerApproved: cleanerStatus === "approved",
    cleanerScreened: latestCleanerScreening(cleaner.id, screenings)?.complete === true,
    pilotAreaCovered: pilotPostcodeCoverage(customerRequest.postcode, config.pilotPostcodes).covered,
    serviceApproved: !requiredService || cleaner.services?.includes(requiredService),
    cleanerTravelCovered: cleanerTravelCoverage(cleaner.travelAreas, customerRequest.postcode).covered,
    availabilityCovered: Boolean(findCleanerAvailabilitySlot(cleaner.id, proposal, availabilityEvents)),
    costModelCurrent: proposalCostModelCurrent(proposal, config),
    briefReviewed: Boolean(latestBrief && latestBrief.status === "reviewed"),
    customerScopeConfirmed: latestBrief?.customerScopeConfirmed === true,
    priceSensitiveScopeConfirmed: Boolean(latestBrief?.priceSensitiveScopeConfirmed),
    scanHoursCovered: Boolean(latestBrief && Number.isFinite(latestBrief.scopeEstimateHours) && proposal.estimatedHours >= latestBrief.scopeEstimateHours),
    profitable: proposal.contribution > 0,
    marginFloorMet: config.minimumContributionMarginPercent > 0 && proposal.marginPercent >= config.minimumContributionMarginPercent,
    minimumHoursMet: config.minimumHours > 0 && proposal.estimatedHours >= config.minimumHours,
    scheduleConflictFree: !findCleanerScheduleConflict(proposal, proposals, proposalUpdates, decisions, bookings)
  };
  const decision = decisions.find((record) => record.proposalId === proposal.id) || null;
  const bookingRecorded = bookings.some((booking) => booking.proposalId === proposal.id);
  return { ok: true, proposal, proposalStatus, customerRequest, cleaner, config, latestBrief, opportunitySnapshot, readyChecks, decision, bookingRecorded };
}

function publicCleanerOpportunity(context) {
  const { proposal, proposalStatus, customerRequest, cleaner, config, latestBrief, opportunitySnapshot, readyChecks, decision, bookingRecorded } = context;
  const pilotCoverage = pilotPostcodeCoverage(customerRequest.postcode, config.pilotPostcodes);
  const displayed = opportunitySnapshot || {
    cleanerName: cleaner.fullName,
    service: customerRequest.service,
    area: pilotCoverage.outwardCode,
    siteSize: customerRequest.siteSize,
    hazards: customerRequest.hazards,
    proposedDate: proposal.proposedDate,
    proposedStartTime: proposal.proposedStartTime,
    proposedEndTime: proposal.proposedEndTime,
    estimatedHours: proposal.estimatedHours,
    cleanerPay: proposal.cleanerPay,
    cleanerRate: proposal.cleanerRate,
    checklist: latestBrief?.status === "reviewed" ? latestBrief.checklist : [],
    scopeSignals: latestBrief?.status === "reviewed" ? latestBrief.scopeSignals : [],
    photoCount: latestBrief?.status === "reviewed" ? latestBrief.photos.length : 0,
    photoSharingConsent: latestBrief?.status === "reviewed" && latestBrief.cleanerPhotoSharingConsent === true,
    roomScanBriefId: "",
    roomPhotos: [],
    cleanerModel: config.cleanerModel,
    legalBusinessName: config.legalBusinessName,
    supportEmail: config.supportEmail,
    supportPhone: config.supportPhone
  };
  const photoAccessAllowed = ["sent", "accepted"].includes(proposalStatus)
    && displayed.photoSharingConsent === true
    && Array.isArray(displayed.roomPhotos)
    && displayed.roomPhotos.length > 0
    && !bookingRecorded
    && Object.values(readyChecks).every(Boolean)
    && (decision?.status === "accepted" || (!decision && offerIsOpen(displayed.offerExpiresAt)));
  return {
    ok: true,
    opportunity: {
      reference: proposal.id,
      status: proposalStatus,
      cleanerName: displayed.cleanerName,
      service: displayed.service,
      area: displayed.area,
      siteSize: displayed.siteSize,
      hazards: displayed.hazards,
      proposedDate: displayed.proposedDate,
      proposedStartTime: displayed.proposedStartTime,
      proposedEndTime: displayed.proposedEndTime,
      estimatedHours: displayed.estimatedHours,
      cleanerPay: displayed.cleanerPay,
      cleanerRate: displayed.cleanerRate,
      checklist: displayed.checklist,
      confirmedExtras: Array.isArray(displayed.scopeSignals) ? displayed.scopeSignals : [],
      photoCount: displayed.photoCount,
      photoSharingConsent: displayed.photoSharingConsent === true,
      photoAccessAllowed,
      roomPhotos: photoAccessAllowed ? displayed.roomPhotos : [],
      cleanerModel: displayed.cleanerModel,
      legalBusinessName: displayed.legalBusinessName,
      supportEmail: displayed.supportEmail,
      supportPhone: displayed.supportPhone,
      offerExpiresAt: displayed.offerExpiresAt || "",
      expired: ["sent", "accepted"].includes(proposalStatus) && !decision && !offerIsOpen(displayed.offerExpiresAt),
      availabilityChanged: ["sent", "accepted"].includes(proposalStatus) && !decision && !readyChecks.availabilityCovered,
      pricingChanged: ["sent", "accepted"].includes(proposalStatus) && !decision && !readyChecks.costModelCurrent,
      decisionAllowed: ["sent", "accepted"].includes(proposalStatus) && !decision && offerIsOpen(displayed.offerExpiresAt) && Object.values(readyChecks).every(Boolean),
      decision: decision ? { status: decision.status, decidedAt: decision.updatedAt, typedName: decision.typedName } : null
    }
  };
}

async function getPrivateCleanerOpportunity(request, response) {
  const token = text(request.headers["x-opportunity-token"], 80);
  const context = await getCleanerOpportunityContext(token);
  if (!context.ok) return json(response, context.statusCode, { ok: false, error: context.error });
  return json(response, 200, publicCleanerOpportunity(context));
}

async function getPrivateCleanerOpportunityPhoto(request, response, imageId) {
  const token = text(request.headers["x-opportunity-token"], 80);
  const context = await getCleanerOpportunityContext(token);
  if (!context.ok) return json(response, 404, { ok: false, error: "Room photo not found." });
  const opportunity = publicCleanerOpportunity(context).opportunity;
  const authorisedPhoto = opportunity.roomPhotos.find((photo) => photo.id === imageId);
  const briefId = text(context.opportunitySnapshot?.roomScanBriefId, 40);
  if (!opportunity.photoAccessAllowed || !authorisedPhoto || !briefId || !/^IMG-[A-Z0-9]{8}$/.test(imageId)) {
    return json(response, 404, { ok: false, error: "Room photo not found." });
  }
  const briefs = await readRecords("job-briefs.ndjson");
  const brief = briefs.find((record) => record.id === briefId && record.requestId === context.proposal.requestId && record.cleanerPhotoSharingConsent === true);
  const photo = brief?.photos?.find((item) => item.id === imageId && item.id === authorisedPhoto.id);
  if (!photo) return json(response, 404, { ok: false, error: "Room photo not found." });
  const resolvedDataDir = path.resolve(dataDir);
  const imagePath = path.resolve(dataDir, photo.storedPath);
  if (!imagePath.startsWith(`${resolvedDataDir}${path.sep}`)) return json(response, 403, { ok: false, error: "Invalid room photo path." });
  try {
    const body = await readFile(imagePath);
    response.writeHead(200, { "Content-Type": photo.mimeType, "Content-Length": body.length, "Cache-Control": "private, no-store", "Content-Disposition": "inline" });
    response.end(body);
  } catch (error) {
    if (error.code === "ENOENT") return json(response, 404, { ok: false, error: "Room photo file not found." });
    throw error;
  }
}

async function decidePrivateCleanerOpportunity(request, response) {
  ensureSameOrigin(request);
  const token = text(request.headers["x-opportunity-token"], 80);
  const input = await readJson(request);
  const context = await getCleanerOpportunityContext(token);
  if (!context.ok) return json(response, context.statusCode, { ok: false, error: context.error });
  if (!["sent", "accepted"].includes(context.proposalStatus)) return json(response, 409, { ok: false, error: "This opportunity is not awaiting a decision." });
  if (context.decision) return json(response, 409, { ok: false, error: "This private decision has already been recorded." });
  if (!offerIsOpen(context.opportunitySnapshot?.offerExpiresAt)) return json(response, 409, { ok: false, error: "This opportunity's response window has ended. Tideway must review and issue a new opportunity." });
  if (!Object.values(context.readyChecks).every(Boolean)) return json(response, 409, { ok: false, error: "This opportunity changed and must be reviewed by Tideway before you decide." });

  const decision = text(input.decision, 20);
  const typedName = text(input.typedName, 120);
  const normalisedName = (value) => value.toLocaleLowerCase("en-GB").replace(/\s+/g, " ").trim();
  if (!["accepted", "declined"].includes(decision)) return json(response, 422, { ok: false, error: "Choose whether to accept or decline this opportunity." });
  if (!typedName || normalisedName(typedName) !== normalisedName(context.cleaner.fullName)) {
    return json(response, 422, { ok: false, error: "Type the same full name used on the cleaner application." });
  }
  if (decision === "accepted" && (input.scopeConfirmed !== true || input.payConfirmed !== true || input.availabilityConfirmed !== true)) {
    return json(response, 422, { ok: false, error: "Confirm the scope, proposed pay and availability before accepting." });
  }

  const displayed = publicCleanerOpportunity(context).opportunity;
  const updatedAt = new Date().toISOString();
  const record = {
    proposalId: context.proposal.id,
    requestId: context.proposal.requestId,
    cleanerId: context.proposal.cleanerId,
    status: decision,
    typedName,
    scopeConfirmed: decision === "accepted",
    payConfirmed: decision === "accepted",
    availabilityConfirmed: decision === "accepted",
    reason: text(input.reason, 500),
    acceptedSnapshot: decision === "accepted" ? {
      service: displayed.service,
      area: displayed.area,
      siteSize: displayed.siteSize,
      hazards: displayed.hazards,
      proposedDate: displayed.proposedDate,
      proposedStartTime: displayed.proposedStartTime,
      proposedEndTime: displayed.proposedEndTime,
      estimatedHours: displayed.estimatedHours,
      cleanerPay: displayed.cleanerPay,
      cleanerRate: displayed.cleanerRate,
      checklist: displayed.checklist,
      confirmedExtras: displayed.confirmedExtras,
      photoSharingConsent: displayed.photoSharingConsent,
      roomPhotos: displayed.photoAccessAllowed ? displayed.roomPhotos : [],
      cleanerModel: displayed.cleanerModel,
      offerExpiresAt: displayed.offerExpiresAt
    } : null,
    updatedAt
  };
  await saveCleanerDecisionOnce(record);
  return json(response, 200, { ok: true, status: decision, decidedAt: updatedAt });
}

async function getAdminProposalDrafts(request, response, proposalId) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  const [proposals, proposalUpdates, customerRequests, cleaners, config, briefs, briefUpdates, availabilityEvents] = await Promise.all([
    readRecords("match-proposals.ndjson"),
    readRecords("proposal-status.ndjson"),
    readRecords("cleaning-requests.ndjson"),
    readRecords("cleaner-applications.ndjson"),
    readJsonFile("business-config.json", {}),
    readRecords("job-briefs.ndjson"),
    readRecords("job-brief-status.ndjson"),
    readRecords("cleaner-availability.ndjson")
  ]);
  const proposal = proposals.find((record) => record.id === proposalId);
  if (!proposal) return json(response, 404, { ok: false, error: "Proposal not found." });
  const customerRequest = customerRequests.find((record) => record.id === proposal.requestId);
  const cleaner = cleaners.find((record) => record.id === proposal.cleanerId);
  if (!customerRequest || !cleaner) return json(response, 404, { ok: false, error: "Proposal parties were not found." });
  let proposalStatus = proposal.status || "draft";
  let quoteSnapshot = null;
  let opportunitySnapshot = null;
  for (const update of proposalUpdates) {
    if (update.proposalId !== proposalId) continue;
    proposalStatus = update.status;
    if (update.quoteSnapshot) quoteSnapshot = update.quoteSnapshot;
    if (update.cleanerOpportunitySnapshot) opportunitySnapshot = update.cleanerOpportunitySnapshot;
  }

  const readiness = launchReadiness(config);
  const pilotCoverage = pilotPostcodeCoverage(customerRequest.postcode, config.pilotPostcodes);
  const rawLatestBrief = briefs.filter((brief) => brief.requestId === customerRequest.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] || null;
  const latestBrief = rawLatestBrief ? applyBriefStatus(rawLatestBrief, briefUpdates) : null;
  const briefReviewed = Boolean(latestBrief && latestBrief.status === "reviewed");
  const customerScopeConfirmed = latestBrief?.customerScopeConfirmed === true;
  const priceSensitiveScopeConfirmed = Boolean(latestBrief?.priceSensitiveScopeConfirmed);
  const scanHoursCovered = Boolean(briefReviewed && Number.isFinite(latestBrief.scopeEstimateHours) && proposal.estimatedHours >= latestBrief.scopeEstimateHours);
  const cleanerTravelCovered = cleanerTravelCoverage(cleaner.travelAreas, customerRequest.postcode).covered;
  const warnings = [];
  if (!readiness.ready) warnings.push("Complete all seven launch-readiness checks before using these drafts.");
  if (!pilotCoverage.covered) warnings.push(`${pilotCoverage.outwardCode || "This postcode"} is outside the configured Tideway pilot area.`);
  if (!["ready", "sent", "accepted"].includes(proposalStatus)) warnings.push("The proposal is still a draft and has not been internally approved.");
  if (!latestBrief) warnings.push("The customer must complete the room scan before a cleaner-ready proposal can be used.");
  else if (!briefReviewed) warnings.push("Review and approve the latest customer room scan before using the cleaner draft.");
  else if (!customerScopeConfirmed) warnings.push("The customer must confirm that the final concise checklist includes every task they want quoted.");
  else if (!priceSensitiveScopeConfirmed) warnings.push("Confirm every detected price-sensitive item inside the reviewed cleaning-time estimate before using this proposal.");
  else if (!scanHoursCovered) warnings.push(`Allow at least ${latestBrief.scopeEstimateHours || "the reviewed"} hours from the room-scan scope estimate before using this proposal.`);
  if (!config.cancellationPolicy) warnings.push("Add an approved cancellation rule.");
  if (!config.paymentTiming) warnings.push("Add the customer payment timing.");
  if (!config.supportEmail || !config.supportPhone) warnings.push("Add verified support contact details.");
  if (!cleanerTravelCovered) warnings.push("The proposed cleaner's stated travel areas do not cover the customer postcode.");
  const availabilityCovered = Boolean(findCleanerAvailabilitySlot(cleaner.id, proposal, availabilityEvents));
  if (!availabilityCovered) warnings.push("The proposed time is no longer covered by an active, confirmed cleaner availability window.");
  const costModelCurrent = proposalCostModelCurrent(proposal, config);
  if (!costModelCurrent) warnings.push("The founder cost assumptions changed after this proposal was calculated; prepare a new proposal before using these drafts.");
  if (proposalStatus === "sent" && !offerIsOpen(quoteSnapshot?.offerExpiresAt)) warnings.push("The customer quote response window has ended; prepare a newly reviewed proposal instead of reusing this draft.");
  if (["sent", "accepted"].includes(proposalStatus) && !offerIsOpen(opportunitySnapshot?.offerExpiresAt)) warnings.push("The cleaner opportunity response window has ended; recheck availability before issuing a new opportunity.");

  const money = (value) => `£${Number(value).toFixed(2)}`;
  const signoff = [config.legalBusinessName || "Tideway", config.supportEmail, config.supportPhone].filter(Boolean).join("\n");
  const responseDeadline = (expiresAt, validityHours) => expiresAt
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(expiresAt))
    : `${validityHours || "[set]"} hours after Tideway records the offer as sent, never later than the visit start`;
  const customerBody = [
    `Hello ${customerRequest.contactName},`,
    "",
    `Thank you for requesting ${customerRequest.service.toLowerCase()} in ${customerRequest.postcode}.`,
    "",
    `Proposed date: ${proposal.proposedDate}`,
    `Proposed time: ${proposal.proposedStartTime}–${proposal.proposedEndTime}`,
    `Site scope: ${customerRequest.siteSize || "[Confirm site size before sending]"}`,
    `Estimated cleaning time: ${proposal.estimatedHours} hours`,
    `Proposed customer total: ${money(proposal.customerTotal)}`,
    ...(latestBrief?.status === "reviewed" && latestBrief.scopeSignals.length ? ["Price-sensitive items included in this reviewed time and total:", ...latestBrief.scopeSignals.map((signal) => `- ${signal.label}`)] : []),
    "",
    `Cancellation: ${config.cancellationPolicy || "[Add the approved cancellation rule before sending]"}`,
    `Payment timing: ${config.paymentTiming || "[Add the approved payment timing before sending]"}`,
    `Respond by: ${responseDeadline(quoteSnapshot?.offerExpiresAt, config.customerQuoteValidityHours)}`,
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
    `Proposed time: ${proposal.proposedStartTime}–${proposal.proposedEndTime}`,
    `Estimated time: ${proposal.estimatedHours} hours`,
    `Proposed cleaner pay: ${money(proposal.cleanerPay)} total (${money(proposal.cleanerRate)} per hour)`,
    ...(latestBrief?.status === "reviewed" && latestBrief.scopeSignals.length ? ["Price-sensitive items included in these hours and proposed pay:", ...latestBrief.scopeSignals.map((signal) => `- ${signal.label}`)] : []),
    `Respond by: ${responseDeadline(opportunitySnapshot?.offerExpiresAt, config.cleanerOpportunityValidityHours)}`,
    ...(latestBrief ? ["", latestBrief.status === "reviewed" ? "Tideway-reviewed cleaner checklist:" : "Landlord-draft cleaner checklist (Tideway review required):", ...latestBrief.checklist.map((task) => `- ${task}`), latestBrief.cleanerPhotoSharingConsent === true ? `Customer-authorised room photos: ${latestBrief.photos.length}. View only through the private opportunity link after Tideway sends it.` : `Photo references held privately: ${latestBrief.photos.length}. The customer has not authorised pre-booking cleaner access.`] : []),
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
    sendAllowed: readiness.ready && pilotCoverage.covered && cleanerTravelCovered && briefReviewed && customerScopeConfirmed && priceSensitiveScopeConfirmed && scanHoursCovered && availabilityCovered && costModelCurrent && ["ready", "sent", "accepted"].includes(proposalStatus),
    warnings,
    customer: { subject: `Tideway cleaning proposal ${proposal.id}`, body: customerBody },
    cleaner: { subject: `Tideway cleaning opportunity ${proposal.id}`, body: cleanerBody }
  });
}

async function buildBookingAudit(proposalId) {
  const [proposals, proposalUpdates, customerRequests, cleaners, cleanerUpdates, config, briefs, briefUpdates, screenings, cleanerDecisions, bookings, availabilityEvents] = await Promise.all([
    readRecords("match-proposals.ndjson"),
    readRecords("proposal-status.ndjson"),
    readRecords("cleaning-requests.ndjson"),
    readRecords("cleaner-applications.ndjson"),
    readRecords("status-updates.ndjson"),
    readJsonFile("business-config.json", {}),
    readRecords("job-briefs.ndjson"),
    readRecords("job-brief-status.ndjson"),
    readRecords("cleaner-screening.ndjson"),
    readRecords("cleaner-opportunity-decisions.ndjson"),
    readRecords("bookings.ndjson"),
    readRecords("cleaner-availability.ndjson")
  ]);
  const proposal = proposals.find((record) => record.id === proposalId);
  if (!proposal) return { statusCode: 404, error: "Proposal not found." };
  const customerRequest = customerRequests.find((record) => record.id === proposal.requestId);
  const cleaner = cleaners.find((record) => record.id === proposal.cleanerId);
  if (!customerRequest || !cleaner) return { statusCode: 404, error: "Proposal parties were not found." };
  let proposalStatus = proposal.status || "draft";
  let customerDecision = null;
  let quoteSnapshot = null;
  let opportunitySnapshot = null;
  for (const update of proposalUpdates) {
    if (update.proposalId !== proposalId) continue;
    proposalStatus = update.status;
    if (update.quoteSnapshot) quoteSnapshot = update.quoteSnapshot;
    if (update.cleanerOpportunitySnapshot) opportunitySnapshot = update.cleanerOpportunitySnapshot;
    if (update.source === "customer-private-quote") customerDecision = update;
  }
  let cleanerStatus = cleaner.status || "new";
  for (const update of cleanerUpdates) if (update.id === cleaner.id) cleanerStatus = update.status;
  const requiredService = requestServiceMap[customerRequest.service] || "";
  const rawLatestBrief = briefs.filter((brief) => brief.requestId === customerRequest.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] || null;
  const latestBrief = rawLatestBrief ? applyBriefStatus(rawLatestBrief, briefUpdates) : null;
  const cleanerDecision = cleanerDecisions.find((record) => record.proposalId === proposal.id) || null;
  const checks = {
    launchReady: launchReadiness(config).ready,
    customerAccepted: proposalStatus === "accepted",
    cleanerAccepted: cleanerDecision?.status === "accepted",
    customerAcceptedBeforeExpiry: customerDecision?.status === "accepted" && decisionWasInTime(customerDecision.updatedAt, quoteSnapshot?.offerExpiresAt),
    cleanerAcceptedBeforeExpiry: cleanerDecision?.status === "accepted" && decisionWasInTime(cleanerDecision.updatedAt, opportunitySnapshot?.offerExpiresAt),
    cleanerApproved: cleanerStatus === "approved",
    cleanerScreened: latestCleanerScreening(cleaner.id, screenings)?.complete === true,
    pilotAreaCovered: pilotPostcodeCoverage(customerRequest.postcode, config.pilotPostcodes).covered,
    serviceApproved: !requiredService || cleaner.services?.includes(requiredService),
    cleanerTravelCovered: cleanerTravelCoverage(cleaner.travelAreas, customerRequest.postcode).covered,
    availabilityCovered: Boolean(findCleanerAvailabilitySlot(cleaner.id, proposal, availabilityEvents)),
    costModelCurrent: proposalCostModelCurrent(proposal, config),
    profitable: proposal.contribution > 0,
    marginFloorMet: config.minimumContributionMarginPercent > 0 && proposal.marginPercent >= config.minimumContributionMarginPercent,
    minimumHoursMet: config.minimumHours > 0 && proposal.estimatedHours >= config.minimumHours,
    briefReviewed: Boolean(latestBrief && latestBrief.status === "reviewed"),
    customerScopeConfirmed: latestBrief?.customerScopeConfirmed === true,
    priceSensitiveScopeConfirmed: Boolean(latestBrief?.priceSensitiveScopeConfirmed),
    scanHoursCovered: Boolean(latestBrief && Number.isFinite(latestBrief.scopeEstimateHours) && proposal.estimatedHours >= latestBrief.scopeEstimateHours),
    scopeCaptured: Boolean(customerRequest.siteSize),
    accessCaptured: Boolean(customerRequest.accessNotes),
    hazardsCaptured: Boolean(customerRequest.hazards),
    scheduleConflictFree: !findCleanerScheduleConflict(proposal, proposals, proposalUpdates, cleanerDecisions, bookings)
  };
  const automatedReady = Object.values(checks).every(Boolean);
  const manualChecklist = [
    "Confirm the exact service address and named access contact through the approved secure process.",
    "Confirm the final task checklist, exclusions, products and equipment with both sides.",
    "Confirm the customer payment authorisation without storing card details in Tideway notes.",
    "Share emergency and issue-reporting instructions before the visit."
  ];
  return { ok: true, proposal, customerRequest, cleaner, config, latestBrief, proposalId, proposalStatus, cleanerDecision: cleanerDecision ? { status: cleanerDecision.status, decidedAt: cleanerDecision.updatedAt } : null, automatedReady, checks, manualChecklist };
}

async function getAdminBookingAudit(request, response, proposalId) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  const audit = await buildBookingAudit(proposalId);
  if (!audit.ok) return json(response, audit.statusCode, { ok: false, error: audit.error });
  const { proposal, customerRequest, cleaner, config, latestBrief, ...publicAudit } = audit;
  return json(response, 200, publicAudit);
}

async function createAdminBooking(request, response) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  ensureSameOrigin(request);
  const input = await readJson(request);
  const proposalId = text(input.proposalId, 40);
  const details = {
    serviceAddress: text(input.serviceAddress, 500),
    servicePostcode: text(input.servicePostcode, 20).toUpperCase(),
    accessContactName: text(input.accessContactName, 120),
    accessContactPhone: text(input.accessContactPhone, 40),
    accessInstructions: text(input.accessInstructions, 1000),
    parkingNotes: text(input.parkingNotes, 500),
    productsAndEquipment: text(input.productsAndEquipment, 1000),
    emergencyInstructions: text(input.emergencyInstructions, 1000)
  };
  const confirmations = {
    addressAndAccessConfirmed: input.addressAndAccessConfirmed === true,
    finalChecklistConfirmed: input.finalChecklistConfirmed === true,
    paymentAuthorisationConfirmed: input.paymentAuthorisationConfirmed === true,
    emergencyInstructionsConfirmed: input.emergencyInstructionsConfirmed === true
  };
  if (!proposalId || !Object.values(confirmations).every(Boolean)) {
    return json(response, 422, { ok: false, error: "Complete every manual booking confirmation before recording a booking." });
  }
  if (!details.serviceAddress || !isUkPostcode(details.servicePostcode) || !details.accessContactName || !isPhone(details.accessContactPhone) || !details.accessInstructions || !details.productsAndEquipment || !details.emergencyInstructions) {
    return json(response, 422, { ok: false, error: "Add the full service address, matching postcode, valid access contact, access instructions, products/equipment and emergency instructions." });
  }
  const audit = await buildBookingAudit(proposalId);
  if (!audit.ok) return json(response, audit.statusCode, { ok: false, error: audit.error });
  if (!audit.automatedReady) return json(response, 422, { ok: false, error: "The automated booking audit must pass before recording a booking.", checks: audit.checks });
  if (details.servicePostcode.replace(/\s+/g, "") !== audit.customerRequest.postcode.replace(/\s+/g, "")) {
    return json(response, 422, { ok: false, error: "The final service postcode must match the postcode accepted in the customer quote." });
  }

  const [updates, bookings] = await Promise.all([
    readRecords("status-updates.ndjson"),
    readRecords("bookings.ndjson")
  ]);
  if (bookings.some((booking) => booking.requestId === audit.customerRequest.id || booking.proposalId === proposalId)) {
    return json(response, 409, { ok: false, error: "A booking is already recorded for this request or proposal." });
  }
  let requestStatus = audit.customerRequest.status || "new";
  for (const update of updates) if (update.id === audit.customerRequest.id) requestStatus = update.status;
  if (requestStatus !== "quoted") return json(response, 422, { ok: false, error: "Move the customer request through contacted to quoted before recording a booking." });

  const booking = {
    id: `BKG-${randomUUID().slice(0, 8).toUpperCase()}`,
    proposalId,
    requestId: audit.customerRequest.id,
    cleanerId: audit.cleaner.id,
    proposedDate: audit.proposal.proposedDate,
    proposedStartTime: audit.proposal.proposedStartTime,
    proposedEndTime: audit.proposal.proposedEndTime,
    estimatedHours: audit.proposal.estimatedHours,
    plannedCustomerTotal: audit.proposal.customerTotal,
    plannedCleanerPay: audit.proposal.cleanerPay,
    plannedContribution: audit.proposal.contribution,
    plannedPaymentFees: audit.proposal.paymentFees,
    plannedTravelCosts: audit.proposal.travelCosts,
    plannedSuppliesCosts: audit.proposal.suppliesCosts,
    plannedRiskContingency: audit.proposal.riskContingency,
    plannedAdditionalCosts: audit.proposal.otherCosts,
    plannedNonCleanerCosts: audit.proposal.nonCleanerCosts,
    costAssumptions: audit.proposal.costAssumptions,
    roomScanBriefId: audit.latestBrief.id,
    details,
    customerViewToken: randomBytes(24).toString("base64url"),
    cleanerViewToken: randomBytes(24).toString("base64url"),
    customerBookingPack: {
      audience: "customer",
      customerName: audit.customerRequest.contactName,
      service: audit.customerRequest.service,
      serviceAddress: details.serviceAddress,
      servicePostcode: details.servicePostcode,
      siteSize: audit.customerRequest.siteSize,
      proposedDate: audit.proposal.proposedDate,
      proposedStartTime: audit.proposal.proposedStartTime,
      proposedEndTime: audit.proposal.proposedEndTime,
      estimatedHours: audit.proposal.estimatedHours,
      customerTotal: audit.proposal.customerTotal,
      checklist: audit.latestBrief?.status === "reviewed" ? audit.latestBrief.checklist : [],
      confirmedExtras: audit.latestBrief?.status === "reviewed" ? audit.latestBrief.scopeSignals : [],
      roomPhotos: audit.latestBrief?.status === "reviewed" ? audit.latestBrief.photos.map(({ id, area, note }) => ({ id, area, note })) : [],
      accessInstructions: details.accessInstructions,
      parkingNotes: details.parkingNotes,
      productsAndEquipment: details.productsAndEquipment,
      emergencyInstructions: details.emergencyInstructions,
      cancellationPolicy: audit.config.cancellationPolicy,
      paymentTiming: audit.config.paymentTiming,
      legalBusinessName: audit.config.legalBusinessName,
      supportEmail: audit.config.supportEmail,
      supportPhone: audit.config.supportPhone
    },
    cleanerBookingPack: {
      audience: "cleaner",
      cleanerName: audit.cleaner.fullName,
      service: audit.customerRequest.service,
      serviceAddress: details.serviceAddress,
      servicePostcode: details.servicePostcode,
      siteSize: audit.customerRequest.siteSize,
      hazards: audit.customerRequest.hazards,
      proposedDate: audit.proposal.proposedDate,
      proposedStartTime: audit.proposal.proposedStartTime,
      proposedEndTime: audit.proposal.proposedEndTime,
      estimatedHours: audit.proposal.estimatedHours,
      cleanerPay: audit.proposal.cleanerPay,
      cleanerRate: audit.proposal.cleanerRate,
      checklist: audit.latestBrief?.status === "reviewed" ? audit.latestBrief.checklist : [],
      confirmedExtras: audit.latestBrief?.status === "reviewed" ? audit.latestBrief.scopeSignals : [],
      roomPhotos: audit.latestBrief?.status === "reviewed" ? audit.latestBrief.photos.map(({ id, area, note }) => ({ id, area, note })) : [],
      accessContactName: details.accessContactName,
      accessContactPhone: details.accessContactPhone,
      accessInstructions: details.accessInstructions,
      parkingNotes: details.parkingNotes,
      productsAndEquipment: details.productsAndEquipment,
      emergencyInstructions: details.emergencyInstructions,
      cleanerModel: audit.config.cleanerModel,
      legalBusinessName: audit.config.legalBusinessName,
      supportEmail: audit.config.supportEmail,
      supportPhone: audit.config.supportPhone
    },
    confirmations,
    internalNote: text(input.internalNote, 1000),
    createdAt: new Date().toISOString()
  };
  booking.customerBookingPack.bookingId = booking.id;
  booking.cleanerBookingPack.bookingId = booking.id;
  await saveBookingOnce(booking);
  await saveRecord("status-updates.ndjson", { id: booking.requestId, kind: "request", status: "booked", previousStatus: requestStatus, source: "booking-confirmation", updatedAt: booking.createdAt });
  return json(response, 201, { ok: true, booking });
}

async function findPrivateBooking(token) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const bookings = await readRecords("bookings.ndjson");
  const booking = bookings.find((record) => record.customerViewToken === token || record.cleanerViewToken === token);
  if (!booking) return null;
  const audience = booking.customerViewToken === token ? "customer" : "cleaner";
  const pack = audience === "customer" ? booking.customerBookingPack : booking.cleanerBookingPack;
  return pack ? { booking, audience, pack } : null;
}

async function getPrivateBookingPack(request, response) {
  const token = text(request.headers["x-booking-token"], 80);
  const context = await findPrivateBooking(token);
  if (!context) return json(response, 404, { ok: false, error: "This private booking link is invalid." });
  const [changes, updates, jobEvents] = await Promise.all([
    readRecords("booking-change-requests.ndjson"),
    readRecords("booking-change-status.ndjson"),
    readRecords("job-events.ndjson")
  ]);
  const ownRequests = changes
    .filter((record) => record.bookingId === context.booking.id && record.audience === context.audience)
    .map((record) => applyBookingChangeStatus(record, updates))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map(({ bookingId, requestId, cleanerId, audience, ...record }) => record);
  return json(response, 200, { ok: true, booking: { ...context.pack, confirmedAt: context.booking.createdAt, changeRequests: ownRequests, jobProgress: bookingJobProgress(context.booking.id, jobEvents) } });
}

async function getPrivateBookingPhoto(request, response, imageId) {
  const token = text(request.headers["x-booking-token"], 80);
  const context = await findPrivateBooking(token);
  if (!context) return json(response, 404, { ok: false, error: "This private booking link is invalid." });
  const briefId = text(context.booking.roomScanBriefId, 40);
  if (!briefId || !/^IMG-[A-Z0-9]{8}$/.test(imageId)) return json(response, 404, { ok: false, error: "Room photo not found." });
  const briefs = await readRecords("job-briefs.ndjson");
  const brief = briefs.find((record) => record.id === briefId && record.requestId === context.booking.requestId);
  const photo = brief?.photos?.find((item) => item.id === imageId);
  if (!photo) return json(response, 404, { ok: false, error: "Room photo not found." });
  const resolvedDataDir = path.resolve(dataDir);
  const imagePath = path.resolve(dataDir, photo.storedPath);
  if (!imagePath.startsWith(`${resolvedDataDir}${path.sep}`)) return json(response, 403, { ok: false, error: "Invalid room photo path." });
  try {
    const body = await readFile(imagePath);
    response.writeHead(200, { "Content-Type": photo.mimeType, "Content-Length": body.length, "Cache-Control": "private, no-store" });
    response.end(body);
  } catch (error) {
    if (error.code === "ENOENT") return json(response, 404, { ok: false, error: "Room photo file not found." });
    throw error;
  }
}

async function getPrivateRequestStatus(request, response) {
  const token = text(request.headers["x-request-token"], 80);
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return json(response, 404, { ok: false, error: "This private request link is invalid." });
  const [requests, statusUpdates, briefs, briefUpdates, proposals, proposalUpdates, cleanerDecisions, bookings, outcomes, jobEvents, availabilityEvents, config, cleaners, screenings] = await Promise.all([
    readRecords("cleaning-requests.ndjson"),
    readRecords("status-updates.ndjson"),
    readRecords("job-briefs.ndjson"),
    readRecords("job-brief-status.ndjson"),
    readRecords("match-proposals.ndjson"),
    readRecords("proposal-status.ndjson"),
    readRecords("cleaner-opportunity-decisions.ndjson"),
    readRecords("bookings.ndjson"),
    readRecords("job-outcomes.ndjson"),
    readRecords("job-events.ndjson"),
    readRecords("cleaner-availability.ndjson"),
    readJsonFile("business-config.json", {}),
    readRecords("cleaner-applications.ndjson"),
    readRecords("cleaner-screening.ndjson")
  ]);
  const customerRequest = requests.find((record) => record.customerStatusToken === token);
  if (!customerRequest) return json(response, 404, { ok: false, error: "This private request link is invalid." });
  let requestStatus = customerRequest.status || "new";
  for (const update of statusUpdates) if (update.id === customerRequest.id) requestStatus = update.status;
  const rawLatestBrief = briefs.filter((brief) => brief.requestId === customerRequest.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] || null;
  const latestBrief = rawLatestBrief ? applyBriefStatus(rawLatestBrief, briefUpdates) : null;
  const requestProposals = proposals.filter((proposal) => proposal.requestId === customerRequest.id).map((proposal) => {
    let status = proposal.status || "draft";
    let quoteExpiresAt = "";
    let cleanerExpiresAt = "";
    let quoteSnapshot = null;
    for (const update of proposalUpdates) {
      if (update.proposalId !== proposal.id) continue;
      status = update.status;
      if (update.quoteSnapshot?.offerExpiresAt) quoteExpiresAt = update.quoteSnapshot.offerExpiresAt;
      if (update.quoteSnapshot) quoteSnapshot = update.quoteSnapshot;
      if (update.cleanerOpportunitySnapshot?.offerExpiresAt) cleanerExpiresAt = update.cleanerOpportunitySnapshot.offerExpiresAt;
    }
    const cleanerDecision = cleanerDecisionForProposal(proposal.id, cleanerDecisions);
    const exhausted = cleanerDecision?.status === "declined" || (status === "sent" && !offerIsOpen(quoteExpiresAt)) || (["sent", "accepted"].includes(status) && !cleanerDecision && !offerIsOpen(cleanerExpiresAt));
    return { ...proposal, status, quoteExpiresAt, cleanerExpiresAt, quoteSnapshot, cleanerDecision, exhausted };
  }).sort((left, right) => {
    const priority = (record) => {
      if (record.status === "accepted" && record.cleanerDecision?.status === "accepted") return 8;
      if (record.status === "accepted" && !record.exhausted) return 7;
      if (record.status === "sent" && !record.exhausted) return 6;
      if (record.status === "ready") return 5;
      if (record.status === "draft") return 4;
      if (["accepted", "sent"].includes(record.status) && record.exhausted) return 2;
      return 1;
    };
    return priority(right) - priority(left) || right.createdAt.localeCompare(left.createdAt);
  });
  const booking = bookings.find((record) => record.requestId === customerRequest.id) || null;
  const proposal = booking ? requestProposals.find((record) => record.id === booking.proposalId) || requestProposals[0] || null : requestProposals[0] || null;
  const cleanerDecision = proposal?.cleanerDecision || null;
  const outcome = booking ? outcomes.find((record) => record.bookingId === booking.id) || null : null;
  const jobProgress = booking ? bookingJobProgress(booking.id, jobEvents) : {};
  const quoteExpired = proposal?.status === "sent" && !offerIsOpen(proposal.quoteExpiresAt);
  const cleanerOfferExpired = proposal?.status === "accepted" && !cleanerDecision && !offerIsOpen(proposal.cleanerExpiresAt);
  const proposalAvailabilityCovered = proposal ? Boolean(findCleanerAvailabilitySlot(proposal.cleanerId, proposal, availabilityEvents)) : false;
  const proposalCostsCurrent = proposal ? proposalCostModelCurrent(proposal, config) : false;
  const selectedCleaner = proposal ? cleaners.find((record) => record.id === proposal.cleanerId) || null : null;
  let selectedCleanerStatus = selectedCleaner?.status || "missing";
  for (const update of statusUpdates) if (selectedCleaner && update.id === selectedCleaner.id) selectedCleanerStatus = update.status;
  const selectedCleanerEligible = proposal ? Object.values(cleanerEligibilityChecks(selectedCleaner, customerRequest, selectedCleanerStatus, screenings)).every(Boolean) : false;
  const selectedCleanerEligibilityLost = Boolean(proposal && !booking && ["sent", "accepted"].includes(proposal.status) && !selectedCleanerEligible);
  const quoteAvailabilityLost = proposal?.status === "sent" && !proposalAvailabilityCovered;
  const cleanerAvailabilityLost = proposal?.status === "accepted" && !cleanerDecision && !proposalAvailabilityCovered;
  const quotePricingChanged = proposal?.status === "sent" && !proposalCostsCurrent;
  const cleanerPricingChanged = proposal?.status === "accepted" && !cleanerDecision && !proposalCostsCurrent;

  let currentStage = "room-scan";
  let headline = "Complete the room scan";
  let nextAction = "Add room photos and spoken notes so Tideway can review the cleaning scope.";
  if (latestBrief?.status === "landlord-draft") {
    currentStage = "scan-review";
    headline = "Room scan received";
    nextAction = "Tideway must review the images, tasks and cleaning-time estimate before preparing a quote.";
  } else if (latestBrief?.status === "needs-revision") {
    currentStage = "scan-revision";
    headline = "Room scan needs an update";
    nextAction = latestBrief.reviewNote || "Submit a revised room scan before Tideway can prepare a quote.";
  } else if (latestBrief?.status === "reviewed") {
    currentStage = "matching";
    headline = "Scope reviewed — matching in progress";
    nextAction = "Tideway is checking cleaner suitability, availability and profitable quote terms.";
  }
  if (proposal?.status === "draft" || proposal?.status === "ready") {
    currentStage = "quote-preparation";
    headline = "Quote being prepared";
    nextAction = "Tideway is checking the schedule, cleaner and job economics before making the quote available.";
  } else if (quotePricingChanged) {
    currentStage = "quote-preparation";
    headline = "Quote needs recalculation";
    nextAction = "Tideway must apply the current confirmed cost assumptions and prepare a new proposal before you can decide.";
  } else if (quoteAvailabilityLost) {
    currentStage = "rematching";
    headline = "Cleaner availability changed";
    nextAction = "Tideway must recheck availability and issue a newly controlled proposal before you can decide.";
  } else if (quoteExpired) {
    currentStage = "quote-expired";
    headline = "Quote response window ended";
    nextAction = "Tideway must recheck the scope, cleaner availability and pricing before issuing a new proposal.";
  } else if (proposal?.status === "sent" && proposal.exhausted && !quoteExpired) {
    currentStage = "rematching";
    headline = "Cleaner unavailable â€” rematching required";
    nextAction = "Tideway must select another screened cleaner and issue a new controlled proposal before booking.";
  } else if (proposal?.status === "sent") {
    currentStage = "quote-review";
    headline = proposal.quoteSnapshot?.replacement ? "Your replacement quote is ready" : "Your quote is ready to review";
    nextAction = proposal.quoteSnapshot?.replacement
      ? "Review every current scope, timing, total and term. A previous decision is not carried into this replacement."
      : "Review the scope, timing, total and terms, then accept or decline through the private quote.";
  } else if (proposal?.status === "accepted") {
    currentStage = "cleaner-confirmation";
    headline = "Quote accepted — cleaner confirmation pending";
    nextAction = "The proposed cleaner must independently confirm the scope, pay and availability.";
  } else if (proposal?.status === "declined") {
    currentStage = "quote-declined";
    headline = "Quote declined";
    nextAction = "No booking was created. Tideway can prepare a different proposal only after the scope and terms are reviewed again.";
  } else if (proposal?.status === "cancelled") {
    currentStage = "rematching";
    headline = "Proposal withdrawn â€” rematching in progress";
    nextAction = "No booking was created. Tideway must review the scope, availability and economics before issuing another proposal.";
  }
  if (proposal?.status === "accepted" && cleanerDecision?.status === "declined") {
    currentStage = "rematching";
    headline = "Cleaner unavailable — rematching required";
    nextAction = "Tideway must select another screened cleaner and issue a new controlled opportunity before booking.";
  } else if (selectedCleanerEligibilityLost) {
    currentStage = "rematching";
    headline = "Cleaner matching changed";
    nextAction = "Tideway is reviewing another eligible cleaner before your booking can continue.";
  } else if (cleanerPricingChanged) {
    currentStage = "rematching";
    headline = "Proposal needs recalculation";
    nextAction = "Tideway must recheck the job economics before the booking can proceed.";
  } else if (cleanerAvailabilityLost) {
    currentStage = "rematching";
    headline = "Cleaner availability changed";
    nextAction = "Tideway must select a confirmed available cleaner before the booking can proceed.";
  } else if (cleanerOfferExpired) {
    currentStage = "rematching";
    headline = "Cleaner response window ended";
    nextAction = "Tideway must recheck cleaner availability and issue a new controlled opportunity before booking.";
  } else if (proposal?.status === "accepted" && cleanerDecision?.status === "accepted") {
    currentStage = "finalising-booking";
    headline = "Both sides accepted — final checks underway";
    nextAction = "Tideway must confirm the final address, access, emergency instructions and payment authorisation before recording the booking.";
  }
  if (booking) {
    currentStage = "booking-confirmed";
    headline = "Cleaning visit confirmed";
    nextAction = "Review the protected booking pack and report any scope, access or safety change before arrival.";
    if (jobProgress.cleanerArrivedAt) {
      currentStage = "clean-in-progress";
      headline = "Cleaner arrival recorded";
      nextAction = "The cleaner is working through the agreed checklist. Use the protected booking pack to report a material issue.";
    }
    if (jobProgress.cleanerCompletedAt) {
      currentStage = "customer-confirmation";
      headline = "Cleaner completion recorded";
      nextAction = "Review the visit details in the booking pack and acknowledge that the service took place.";
    }
    if (jobProgress.customerCompletedAt) {
      currentStage = "completion-recorded";
      headline = "Visit completion acknowledged";
      nextAction = "Tideway can now review the actual job economics after all open change or safety requests are closed.";
    }
  }
  if (outcome) {
    currentStage = "completed";
    headline = "Cleaning job completed";
    nextAction = "The operational and financial outcome has been recorded. No payment action is available on this tracker.";
  } else if (requestStatus === "lost") {
    currentStage = "closed";
    headline = "Request closed";
    nextAction = "No active booking is attached to this request.";
  }

  const scanComplete = latestBrief?.status === "reviewed";
  const quoteComplete = proposal?.status === "accepted";
  const cleanerComplete = cleanerDecision?.status === "accepted" && !selectedCleanerEligibilityLost;
  const bookingComplete = Boolean(booking);
  const cleanComplete = Boolean(outcome || jobProgress.customerCompletedAt);
  const steps = [
    { key: "request", label: "Request received", state: "complete", detail: `Reference ${customerRequest.id}` },
    { key: "scan", label: "Room scan reviewed", state: scanComplete ? "complete" : ["room-scan", "scan-revision"].includes(currentStage) ? "action" : "current", detail: !latestBrief ? "Photos and spoken notes required" : latestBrief.status === "reviewed" ? `${latestBrief.checklist.length} tasks · ${latestBrief.scopeEstimateHours} reviewed hours` : latestBrief.status === "needs-revision" ? "Revision requested" : "Awaiting Tideway review" },
    { key: "quote", label: "Quote accepted", state: quoteComplete ? "complete" : ["quote-review", "quote-expired"].includes(currentStage) ? "action" : proposal ? "current" : "waiting", detail: quoteExpired ? "Response window ended" : proposal ? proposal.status : "Not prepared yet" },
    { key: "cleaner", label: "Cleaner confirmed", state: cleanerComplete ? "complete" : selectedCleanerEligibilityLost || cleanerDecision?.status === "declined" ? "action" : quoteComplete ? "current" : "waiting", detail: selectedCleanerEligibilityLost ? "Rematching in progress" : cleanerDecision?.status || "Awaiting an accepted quote" },
    { key: "booking", label: "Visit confirmed", state: bookingComplete ? "complete" : cleanerComplete ? "current" : "waiting", detail: booking ? `${booking.proposedDate} · ${booking.proposedStartTime}–${booking.proposedEndTime}` : "Final checks pending" },
    { key: "clean", label: "Clean completed", state: cleanComplete ? "complete" : bookingComplete ? "current" : "waiting", detail: cleanComplete ? "Completion recorded" : bookingComplete ? "Visit not completed yet" : "Waiting for a confirmed visit" }
  ];
  const outwardCode = customerRequest.postcode.replace(/\s+/g, "").slice(0, -3);
  return json(response, 200, {
    ok: true,
    request: { reference: customerRequest.id, service: customerRequest.service, propertyType: customerRequest.propertyType, siteSize: customerRequest.siteSize, outwardCode, preferredDate: customerRequest.preferredDate || "" },
    current: { stage: currentStage, headline, nextAction },
    steps,
    roomScan: latestBrief ? { status: latestBrief.status, reference: latestBrief.id, taskCount: latestBrief.checklist.length, photoCount: latestBrief.photos.length, reviewedHours: latestBrief.scopeEstimateHours, confidence: latestBrief.scopeConfidence, confirmedExtras: latestBrief.status === "reviewed" && latestBrief.priceSensitiveScopeConfirmed ? latestBrief.scopeSignals.map((signal) => signal.label) : [], revisionNote: latestBrief.status === "needs-revision" ? latestBrief.reviewNote : "" } : null,
    visit: booking ? { reference: booking.id, proposedDate: booking.proposedDate, proposedStartTime: booking.proposedStartTime, proposedEndTime: booking.proposedEndTime, jobProgress } : null,
    links: {
      roomScanRequired: !latestBrief || latestBrief.status === "needs-revision",
      quoteToken: proposal && ["sent", "accepted"].includes(proposal.status) && !proposal.exhausted && !quoteExpired && !quoteAvailabilityLost && !quotePricingChanged && !selectedCleanerEligibilityLost ? proposal.reviewToken : "",
      bookingToken: booking?.customerViewToken || ""
    }
  });
}

async function createPrivateBookingChangeRequest(request, response) {
  ensureSameOrigin(request);
  const token = text(request.headers["x-booking-token"], 80);
  const context = await findPrivateBooking(token);
  if (!context) return json(response, 404, { ok: false, error: "This private booking link is invalid." });
  const input = await readJson(request);
  const type = text(input.type, 40);
  const message = text(input.message, 1200);
  const proposedDate = text(input.proposedDate, 20);
  const proposedStartTime = text(input.proposedStartTime, 10);
  const allowedTypes = new Set(["reschedule", "cancel-request", "access-change", "scope-change", "safety-issue", "other"]);
  const errors = [];
  if (!allowedTypes.has(type)) errors.push("Choose a valid request type.");
  if (message.length < 10) errors.push("Explain the requested change or issue in at least 10 characters.");
  if (type === "reschedule") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(proposedDate) || proposedDate < localDateToday()) errors.push("Choose a proposed reschedule date of today or later.");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(proposedStartTime)) errors.push("Choose a proposed reschedule start time.");
    if (/^\d{4}-\d{2}-\d{2}$/.test(proposedDate) && /^([01]\d|2[0-3]):[0-5]\d$/.test(proposedStartTime) && !jobSchedule({ proposedDate, proposedStartTime, estimatedHours: 1 })) errors.push("Choose a real calendar date and time.");
  }
  if (errors.length) return json(response, 422, { ok: false, errors });
  const record = {
    id: `CHG-${randomUUID().slice(0, 8).toUpperCase()}`,
    bookingId: context.booking.id,
    requestId: context.booking.requestId,
    cleanerId: context.booking.cleanerId,
    audience: context.audience,
    type,
    message,
    proposedDate: type === "reschedule" ? proposedDate : "",
    proposedStartTime: type === "reschedule" ? proposedStartTime : "",
    status: "open",
    createdAt: new Date().toISOString()
  };
  await saveBookingChangeRequest(record);
  return json(response, 201, { ok: true, reference: record.id, status: record.status });
}

async function createPrivateJobEvent(request, response) {
  ensureSameOrigin(request);
  const token = text(request.headers["x-booking-token"], 80);
  const context = await findPrivateBooking(token);
  if (!context) return json(response, 404, { ok: false, error: "This private booking link is invalid." });
  const input = await readJson(request);
  const type = text(input.type, 40);
  const allowed = context.audience === "cleaner" ? new Set(["cleaner-arrived", "cleaner-completed"]) : new Set(["customer-completed"]);
  if (!allowed.has(type)) return json(response, 403, { ok: false, error: "This booking view cannot record that job event." });
  const requiredByType = {
    "cleaner-arrived": ["addressConfirmed", "safeToStart", "scopeAccessible"],
    "cleaner-completed": ["checklistCompleted", "siteSecured", "issuesDisclosed"],
    "customer-completed": ["serviceReceived", "completionDetailsAccurate"]
  };
  const confirmations = Object.fromEntries(requiredByType[type].map((name) => [name, input[name] === true]));
  if (!Object.values(confirmations).every(Boolean)) return json(response, 422, { ok: false, error: "Complete every job-event confirmation before submitting." });
  const record = {
    id: `EVT-${randomUUID().slice(0, 8).toUpperCase()}`,
    bookingId: context.booking.id,
    requestId: context.booking.requestId,
    cleanerId: context.booking.cleanerId,
    audience: context.audience,
    type,
    confirmations,
    note: text(input.note, 1000),
    createdAt: new Date().toISOString()
  };
  await saveJobEvent(record);
  return json(response, 201, { ok: true, reference: record.id, type, recordedAt: record.createdAt });
}

async function updateAdminBookingChangeStatus(request, response) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  ensureSameOrigin(request);
  const input = await readJson(request);
  const changeRequestId = text(input.changeRequestId, 40);
  const status = text(input.status, 30);
  const note = text(input.note, 1000);
  const [records, updates] = await Promise.all([
    readRecords("booking-change-requests.ndjson"),
    readRecords("booking-change-status.ndjson")
  ]);
  const record = records.find((item) => item.id === changeRequestId);
  if (!record) return json(response, 404, { ok: false, error: "Booking change request not found." });
  const current = applyBookingChangeStatus(record, updates).status;
  const transitions = { open: new Set(["reviewing", "closed"]), reviewing: new Set(["open", "closed"]), closed: new Set([]) };
  if (!transitions[current]?.has(status)) return json(response, 422, { ok: false, error: `Change request cannot move from ${current} to ${status}.` });
  if (status === "closed" && note.length < 10) return json(response, 422, { ok: false, error: "Add a clear closure note of at least 10 characters." });
  const update = { changeRequestId, bookingId: record.bookingId, status, previousStatus: current, note, updatedAt: new Date().toISOString() };
  await saveRecord("booking-change-status.ndjson", update);
  return json(response, 200, { ok: true, changeRequestId, status, resolutionNote: note, updatedAt: update.updatedAt });
}

async function createAdminJobOutcome(request, response) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  ensureSameOrigin(request);
  const input = await readJson(request);
  const bookingId = text(input.bookingId, 40);
  const actualHours = Number(input.actualHours);
  const customerCollected = Number(input.customerCollected);
  const cleanerPaid = Number(input.cleanerPaid);
  const paymentFees = Number(input.paymentFees || 0);
  const travelCosts = Number(input.travelCosts || 0);
  const suppliesCosts = Number(input.suppliesCosts || 0);
  const otherCosts = Number(input.otherCosts || 0);
  const refundAmount = Number(input.refundAmount || 0);
  const values = [actualHours, customerCollected, cleanerPaid, paymentFees, travelCosts, suppliesCosts, otherCosts, refundAmount];
  if (!bookingId || values.some((value) => !Number.isFinite(value)) || actualHours <= 0 || customerCollected <= 0 || values.slice(2).some((value) => value < 0)) {
    return json(response, 422, { ok: false, error: "Enter valid actual hours and non-negative job amounts; customer collected must be greater than zero." });
  }
  const [bookings, outcomes, updates, config, jobEvents, bookingChanges, bookingChangeUpdates] = await Promise.all([
    readRecords("bookings.ndjson"),
    readRecords("job-outcomes.ndjson"),
    readRecords("status-updates.ndjson"),
    readJsonFile("business-config.json", {}),
    readRecords("job-events.ndjson"),
    readRecords("booking-change-requests.ndjson"),
    readRecords("booking-change-status.ndjson")
  ]);
  const booking = bookings.find((record) => record.id === bookingId);
  if (!booking) return json(response, 404, { ok: false, error: "Booking not found." });
  if (outcomes.some((record) => record.bookingId === bookingId)) return json(response, 409, { ok: false, error: "A completed-job outcome is already recorded for this booking." });
  const progress = bookingJobProgress(booking.id, jobEvents);
  if (!progress.readyForOutcome) return json(response, 422, { ok: false, error: "Cleaner arrival, cleaner completion and customer completion acknowledgement must all be recorded before job economics." });
  const unresolvedChanges = bookingChanges.filter((change) => change.bookingId === booking.id).map((change) => applyBookingChangeStatus(change, bookingChangeUpdates)).filter((change) => ["open", "reviewing"].includes(change.status));
  if (unresolvedChanges.length) return json(response, 422, { ok: false, error: "Resolve every open booking change or safety request before recording final job economics." });
  let requestStatus = "new";
  for (const update of updates) if (update.id === booking.requestId) requestStatus = update.status;
  if (requestStatus !== "booked") return json(response, 422, { ok: false, error: "Only a booked request can be completed." });

  const totalDirectCosts = moneyValue(paymentFees + travelCosts + suppliesCosts + otherCosts);
  const contribution = moneyValue(customerCollected - cleanerPaid - totalDirectCosts - refundAmount);
  const marginPercent = (contribution / customerCollected) * 100;
  const outcome = {
    id: `JOB-${randomUUID().slice(0, 8).toUpperCase()}`,
    bookingId,
    requestId: booking.requestId,
    cleanerId: booking.cleanerId,
    actualHours,
    customerCollected,
    cleanerPaid,
    paymentFees,
    travelCosts,
    suppliesCosts,
    otherCosts,
    totalDirectCosts,
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
  const proposedStartTime = text(input.proposedStartTime, 10);
  const estimatedHours = Math.max(0, Number(input.estimatedHours) || 0);
  const customerRate = Math.max(0, Number(input.customerRate) || 0);
  const cleanerRate = Math.max(0, Number(input.cleanerRate) || 0);
  const otherCosts = Math.max(0, Number(input.otherCosts) || 0);
  const note = text(input.note, 1000);

  const errors = [];
  if (!requestId || !cleanerId) errors.push("Customer request and cleaner are required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(proposedDate)) errors.push("Choose a proposed date.");
  if (proposedDate && proposedDate < localDateToday()) errors.push("Proposed date cannot be in the past.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(proposedStartTime)) errors.push("Choose an exact proposed start time.");
  if (estimatedHours <= 0 || estimatedHours > 16 || customerRate <= 0 || cleanerRate <= 0) errors.push("Hours must be between 0 and 16, and customer rate and cleaner pay must be greater than zero.");
  const schedule = jobSchedule({ proposedDate, proposedStartTime, estimatedHours });
  if (proposedDate && proposedStartTime && estimatedHours > 0 && !schedule) errors.push("The proposed cleaning must start and finish on a valid calendar date.");
  if (errors.length) return json(response, 422, { ok: false, errors });

  const [requests, cleaners, updates, config, screenings, availabilityEvents, proposals, bookings] = await Promise.all([
    readRecords("cleaning-requests.ndjson"),
    readRecords("cleaner-applications.ndjson"),
    readRecords("status-updates.ndjson"),
    readJsonFile("business-config.json", {}),
    readRecords("cleaner-screening.ndjson"),
    readRecords("cleaner-availability.ndjson"),
    readRecords("match-proposals.ndjson"),
    readRecords("bookings.ndjson")
  ]);
  const customerRequest = requests.find((record) => record.id === requestId);
  const cleaner = cleaners.find((record) => record.id === cleanerId);
  const latestStatuses = new Map();
  for (const update of updates) latestStatuses.set(update.id, update.status);
  if (!customerRequest || !cleaner) return json(response, 404, { ok: false, error: "Customer request or cleaner was not found." });
  if (bookings.some((booking) => booking.requestId === requestId)) return json(response, 409, { ok: false, error: "This request already has a confirmed booking. Use the protected booking-change workflow instead of creating another proposal." });
  if ((latestStatuses.get(cleaner.id) || cleaner.status) !== "approved") return json(response, 422, { ok: false, error: "Only an approved cleaner can be proposed." });
  if (!latestCleanerScreening(cleaner.id, screenings)?.complete) return json(response, 422, { ok: false, error: "Only a fully screened cleaner can be proposed." });
  if (!costAssumptionsConfirmed(config)) return json(response, 422, { ok: false, error: "Confirm the payment, travel, supplies and risk cost assumptions before preparing proposal economics." });
  if (config.minimumHours > 0 && estimatedHours < config.minimumHours) return json(response, 422, { ok: false, error: `Estimated hours must meet the ${config.minimumHours}-hour minimum.` });
  const requiredService = requestServiceMap[customerRequest.service] || "";
  if (requiredService && !cleaner.services?.includes(requiredService)) return json(response, 422, { ok: false, error: "Cleaner is not approved for the requested service." });
  const travelCoverage = cleanerTravelCoverage(cleaner.travelAreas, customerRequest.postcode);
  if (!travelCoverage.covered) return json(response, 422, { ok: false, error: `The cleaner's stated travel areas do not explicitly cover ${travelCoverage.outwardCode || "the customer postcode"}. Reconfirm their work areas before preparing a proposal.` });
  if (!findCleanerAvailabilitySlot(cleaner.id, { proposedDate, proposedStartTime, estimatedHours }, availabilityEvents)) return json(response, 422, { ok: false, error: "The proposed visit must fit entirely inside an active, confirmed cleaner availability window." });

  const economics = calculateProposalEconomics(estimatedHours, customerRate, cleanerRate, otherCosts, config);
  const { customerTotal, cleanerPay, paymentFees, travelCosts, suppliesCosts, riskContingency, nonCleanerCosts, contribution, marginPercent, costAssumptions } = economics;
  if (contribution <= 0) return json(response, 422, { ok: false, error: "This proposal loses money before overheads. Change the price, pay or scope." });
  if (config.minimumContributionMarginPercent > 0 && marginPercent < config.minimumContributionMarginPercent) {
    return json(response, 422, { ok: false, error: `This proposal's ${marginPercent.toFixed(1)}% contribution margin is below the ${config.minimumContributionMarginPercent.toFixed(1)}% minimum.` });
  }
  const previousProposals = proposals.filter((record) => record.requestId === requestId).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const previousProposal = previousProposals[0] || null;
  const proposal = {
    id: `PRO-${randomUUID().slice(0, 8).toUpperCase()}`,
    requestId,
    replacesProposalId: previousProposal?.id || "",
    replacementSequence: previousProposals.length,
    cleanerId,
    cleanerName: cleaner.fullName,
    proposedDate,
    proposedStartTime,
    proposedEndTime: schedule.proposedEndTime,
    estimatedHours,
    customerRate,
    cleanerRate,
    otherCosts,
    paymentFees,
    travelCosts,
    suppliesCosts,
    riskContingency,
    nonCleanerCosts,
    costAssumptions,
    customerTotal,
    cleanerPay,
    contribution,
    marginPercent,
    note,
    reviewToken: randomBytes(24).toString("base64url"),
    cleanerReviewToken: randomBytes(24).toString("base64url"),
    status: "draft",
    createdAt: new Date().toISOString()
  };
  await saveRecord("match-proposals.ndjson", proposal);
  return json(response, 201, { ok: true, proposal });
}

async function getAdminMatches(request, response, requestId) {
  if (!isAdminAuthorised(request)) return json(response, 401, { ok: false, error: "Admin access is not authorised." });
  const [requests, cleaners, updates, screenings, availabilityEvents, briefs, briefUpdates, proposals, proposalUpdates, cleanerDecisions, bookings] = await Promise.all([
    readRecords("cleaning-requests.ndjson"),
    readRecords("cleaner-applications.ndjson"),
    readRecords("status-updates.ndjson"),
    readRecords("cleaner-screening.ndjson"),
    readRecords("cleaner-availability.ndjson"),
    readRecords("job-briefs.ndjson"),
    readRecords("job-brief-status.ndjson"),
    readRecords("match-proposals.ndjson"),
    readRecords("proposal-status.ndjson"),
    readRecords("cleaner-opportunity-decisions.ndjson"),
    readRecords("bookings.ndjson")
  ]);
  const customerRequest = requests.find((record) => record.id === requestId);
  if (!customerRequest) return json(response, 404, { ok: false, error: "Customer request not found." });
  const config = await readJsonFile("business-config.json", {});
  const pilotCoverage = pilotPostcodeCoverage(customerRequest.postcode, config.pilotPostcodes);
  if (!pilotCoverage.covered) {
    return json(response, 200, { ok: true, request: { id: customerRequest.id, postcode: customerRequest.postcode, service: customerRequest.service, preferredDate: customerRequest.preferredDate || "", preferredTimeWindow: customerRequest.preferredTimeWindow || "Flexible" }, pilotCoverage, matchGate: { ready: false, reason: "outside-pilot-area", requiredHours: null }, matches: [] });
  }

  const rawLatestBrief = briefs.filter((brief) => brief.requestId === customerRequest.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] || null;
  const latestBrief = rawLatestBrief ? applyBriefStatus(rawLatestBrief, briefUpdates) : null;
  if (latestBrief?.status === "reviewed" && latestBrief.customerScopeConfirmed !== true) {
    return json(response, 200, { ok: true, request: { id: customerRequest.id, postcode: customerRequest.postcode, service: customerRequest.service, preferredDate: customerRequest.preferredDate || "", preferredTimeWindow: customerRequest.preferredTimeWindow || "Flexible" }, pilotCoverage, matchGate: { ready: false, reason: "customer-scope-confirmation-required", requiredHours: null, confirmedExtras: [] }, matches: [] });
  }
  if (latestBrief?.status === "reviewed" && !latestBrief.priceSensitiveScopeConfirmed) {
    return json(response, 200, { ok: true, request: { id: customerRequest.id, postcode: customerRequest.postcode, service: customerRequest.service, preferredDate: customerRequest.preferredDate || "", preferredTimeWindow: customerRequest.preferredTimeWindow || "Flexible" }, pilotCoverage, matchGate: { ready: false, reason: "price-sensitive-scope-review-required", requiredHours: null, confirmedExtras: [] }, matches: [] });
  }
  const requiredHours = latestBrief?.status === "reviewed" && latestBrief.customerScopeConfirmed === true && latestBrief.priceSensitiveScopeConfirmed && Number.isFinite(latestBrief.scopeEstimateHours) ? latestBrief.scopeEstimateHours : null;
  if (!requiredHours) {
    return json(response, 200, { ok: true, request: { id: customerRequest.id, postcode: customerRequest.postcode, service: customerRequest.service, preferredDate: customerRequest.preferredDate || "", preferredTimeWindow: customerRequest.preferredTimeWindow || "Flexible" }, pilotCoverage, matchGate: { ready: false, reason: "reviewed-room-scan-required", requiredHours: null }, matches: [] });
  }

  const latestStatuses = new Map();
  for (const update of updates) latestStatuses.set(update.id, update.status);
  const requiredService = requestServiceMap[customerRequest.service] || "";
  const nowMs = Date.now();

  const candidates = cleaners
    .filter((cleaner) => (latestStatuses.get(cleaner.id) || cleaner.status) === "approved" && latestCleanerScreening(cleaner.id, screenings)?.complete)
    .map((cleaner) => {
      const busyIntervals = cleanerBusyIntervals(cleaner.id, proposals, proposalUpdates, cleanerDecisions, bookings);
      const availabilitySlots = activeCleanerAvailability(availabilityEvents, cleaner.id)
        .map((slot) => schedulableAvailability(slot, customerRequest, requiredHours, nowMs, busyIntervals))
        .filter(Boolean)
        .sort((left, right) => left.availableDate.localeCompare(right.availableDate) || left.suggestedStartTime.localeCompare(right.suggestedStartTime));
      const services = Array.isArray(cleaner.services) ? cleaner.services : [];
      const serviceMatch = !requiredService || services.includes(requiredService);
      const travelCoverage = cleanerTravelCoverage(cleaner.travelAreas, customerRequest.postcode);
      const coverageScore = travelCoverage.exact ? 35 : travelCoverage.area ? 20 : 0;
      const serviceScore = serviceMatch ? 25 : 0;
      const dateScore = customerRequest.preferredDate ? 20 : 10;
      const scheduleScore = availabilitySlots.length ? 20 : 0;
      const score = dateScore + scheduleScore + coverageScore + serviceScore;
      return {
        id: cleaner.id,
        fullName: cleaner.fullName,
        email: cleaner.email,
        phone: cleaner.phone,
        postcode: cleaner.postcode,
        travelAreas: cleaner.travelAreas,
        availability: cleaner.availability,
        availabilitySlots,
        scheduleFit: customerRequest.preferredDate
          ? `${requiredHours} reviewed hours fit ${customerRequest.preferredDate}${customerRequest.preferredTimeWindow && customerRequest.preferredTimeWindow !== "Flexible" ? ` within the ${preferredArrivalWindows[customerRequest.preferredTimeWindow]?.label || "requested arrival window"}` : ""}`
          : `${requiredHours} reviewed hours fit this confirmed window`,
        experience: cleaner.experience,
        services,
        serviceMatch,
        travelCoverageCovered: travelCoverage.covered,
        coverage: travelCoverage.exact ? "Postcode district listed" : travelCoverage.area ? "Postcode area listed" : "Outside stated travel area",
        score
      };
    });
  const matches = candidates
    .filter((cleaner) => cleaner.serviceMatch && cleaner.travelCoverageCovered && cleaner.availabilitySlots.length > 0)
    .sort((left, right) => right.score - left.score || left.fullName.localeCompare(right.fullName))
    .slice(0, 10);
  const travelCoverageBlocked = candidates.some((cleaner) => cleaner.serviceMatch && !cleaner.travelCoverageCovered && cleaner.availabilitySlots.length > 0);

  return json(response, 200, { ok: true, request: { id: customerRequest.id, postcode: customerRequest.postcode, service: customerRequest.service, preferredDate: customerRequest.preferredDate || "", preferredTimeWindow: customerRequest.preferredTimeWindow || "Flexible" }, pilotCoverage, matchGate: { ready: true, reason: matches.length ? "schedulable-matches-found" : travelCoverageBlocked ? "no-cleaner-travel-coverage" : "no-schedulable-window", requiredHours, confirmedExtras: latestBrief.scopeSignals.map((signal) => signal.label) }, matches });
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
    paymentFeePercent: Math.max(0, Number(input.paymentFeePercent) || 0),
    paymentFeeFixed: Math.max(0, Number(input.paymentFeeFixed) || 0),
    travelCostPerJob: Math.max(0, Number(input.travelCostPerJob) || 0),
    suppliesCostPerJob: Math.max(0, Number(input.suppliesCostPerJob) || 0),
    riskContingencyPercent: Math.max(0, Number(input.riskContingencyPercent) || 0),
    variableCostsConfirmed: input.variableCostsConfirmed === true || ["true", "on"].includes(text(input.variableCostsConfirmed, 10).toLowerCase()),
    customerQuoteValidityHours: Number(input.customerQuoteValidityHours) || 0,
    cleanerOpportunityValidityHours: Number(input.cleanerOpportunityValidityHours) || 0,
    cancellationPolicy: text(input.cancellationPolicy, 1000),
    paymentTiming: text(input.paymentTiming, 100),
    updatedAt: new Date().toISOString()
  };
  const errors = [];
  if (config.supportEmail && !isEmail(config.supportEmail)) errors.push("Enter a valid support email.");
  if (config.supportPhone && !isPhone(config.supportPhone)) errors.push("Enter a valid support phone number.");
  const pilotCoverage = pilotPostcodeCoverage("", config.pilotPostcodes);
  if (pilotCoverage.invalidCodes.length) errors.push(`Use comma-separated outward postcode codes only, for example SW2, SW4. Invalid: ${pilotCoverage.invalidCodes.join(", ")}.`);
  if (config.customerHourlyRate > 0 && config.cleanerHourlyPay > 0 && config.customerHourlyRate <= config.cleanerHourlyPay) errors.push("Customer rate must be higher than cleaner pay before other costs.");
  if (config.minimumContributionMarginPercent >= 100) errors.push("Minimum contribution margin must be below 100%.");
  if (config.paymentFeePercent > 20) errors.push("Payment fee percentage must be between 0% and 20%.");
  if (config.paymentFeeFixed > 20) errors.push("Fixed payment fee must be between £0 and £20.");
  if (config.travelCostPerJob > 200 || config.suppliesCostPerJob > 200) errors.push("Travel and supplies assumptions must each be between £0 and £200 per job.");
  if (config.riskContingencyPercent > 50) errors.push("Risk contingency must be between 0% and 50%.");
  if (config.minimumContributionMarginPercent + config.paymentFeePercent + config.riskContingencyPercent >= 100) errors.push("The margin floor plus payment-fee and risk percentages must stay below 100%.");
  if (config.customerQuoteValidityHours && (!Number.isInteger(config.customerQuoteValidityHours) || config.customerQuoteValidityHours < 1 || config.customerQuoteValidityHours > 168)) errors.push("Customer quote response window must be a whole number from 1 to 168 hours.");
  if (config.cleanerOpportunityValidityHours && (!Number.isInteger(config.cleanerOpportunityValidityHours) || config.cleanerOpportunityValidityHours < 1 || config.cleanerOpportunityValidityHours > 168)) errors.push("Cleaner opportunity response window must be a whole number from 1 to 168 hours.");
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
  const customerScopeConfirmed = input.scopeCompleteConfirmed === true;
  const cleanerPhotoSharingConsent = input.sharePhotosWithSelectedCleaner === true;
  const suppliedTasks = Array.isArray(input.checklist) ? input.checklist.map(normaliseChecklistTask).filter(Boolean) : [];
  const checklist = [...new Map((suppliedTasks.length ? suppliedTasks : checklistFromTranscript(transcript)).map((task) => [task.toLowerCase(), task])).values()].slice(0, 40);
  const photoInputs = Array.isArray(input.photos) ? input.photos.slice(0, maxBriefPhotos + 1) : [];
  const scopeSignals = detectPriceSensitiveScope({ transcript, checklist, photos: photoInputs });
  const errors = [];
  if (!/^REQ-[A-Z0-9]{8}$/.test(requestId)) errors.push("Enter a valid Tideway cleaning-request reference.");
  if (!isEmail(email)) errors.push("Enter the email used for the cleaning request.");
  if (!transcript) errors.push("Add or dictate the cleaning instructions.");
  if (!checklist.length) errors.push("Generate and review at least one checklist task.");
  if (!photoInputs.length) errors.push("Add at least one property photo.");
  if (photoInputs.length > maxBriefPhotos) errors.push(`Add no more than ${maxBriefPhotos} property photos.`);
  if (photoInputs.some((photo) => !briefRoomAreas.has(text(photo?.area, 80)))) errors.push("Choose a valid room for every property photo.");
  if (photoInputs.some((photo) => text(photo?.note, 500).length < 3)) errors.push("Add a short room note explaining what every photo shows.");
  const photographedAreas = [...new Set(photoInputs.map((photo) => text(photo?.area, 80)).filter((area) => briefRoomAreas.has(area)))];
  const uncoveredAreas = photographedAreas.filter((area) => !checklist.some((task) => task.toLowerCase().startsWith(`${area.toLowerCase()}:`)));
  if (uncoveredAreas.length) errors.push(`Add at least one room-labelled checklist task for: ${uncoveredAreas.join(", ")}.`);
  if (!customerScopeConfirmed) errors.push("Review the concise cleaner checklist and confirm that it includes every task you want quoted.");
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
    note: image.note,
    mimeType: image.mimeType,
    storedPath: path.posix.join("job-brief-images", briefId, `${image.id}${image.extension}`)
  }));
  const createdAt = new Date().toISOString();
  const brief = {
    id: briefId,
    requestId,
    transcript,
    checklist,
    photos,
    scopeSignals,
    customerScopeConfirmed,
    customerScopeConfirmedAt: createdAt,
    cleanerPhotoSharingConsent,
    status: "landlord-draft",
    createdAt
  };
  await saveJobBrief(brief, images);
  return json(response, 201, { ok: true, reference: brief.id, customerStatusToken: customerRequest.customerStatusToken || "", checklist: brief.checklist, photos: brief.photos.map(({ id, area, note }) => ({ id, area, note })), scopeSignals: brief.scopeSignals, customerScopeConfirmed: brief.customerScopeConfirmed, customerScopeConfirmedAt: brief.customerScopeConfirmedAt, cleanerPhotoSharingConsent: brief.cleanerPhotoSharingConsent });
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
    customerStatusToken: randomBytes(24).toString("base64url"),
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
    preferredTimeWindow: text(input.preferredTimeWindow, 80),
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
  if (record.preferredDate && (!/^\d{4}-\d{2}-\d{2}$/.test(record.preferredDate) || record.preferredDate < localDateToday())) errors.push("Preferred date must be today or later.");
  if (record.preferredTimeWindow && !Object.hasOwn(preferredArrivalWindows, record.preferredTimeWindow)) errors.push("Choose a supported preferred arrival window.");
  if (!record.consent) errors.push("Privacy consent is required.");
  if (errors.length) return json(response, 422, { ok: false, errors });

  await saveRecord("cleaning-requests.ndjson", record);
  return json(response, 201, { ok: true, reference: record.id, customerStatusToken: record.customerStatusToken });
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
  if (record.travelAreas && !parseCleanerTravelAreas(record.travelAreas).valid) errors.push("List at least one outward postcode district such as SW1A, or a comma-separated postcode area such as SW, SE.");
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
    "/brief-complete": "brief-complete.html",
    "/request-status": "request-status.html",
    "/quote": "quote.html",
    "/opportunity": "opportunity.html",
    "/booking-confirmation": "booking-pack.html",
    "/assignment": "booking-pack.html",
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
    if (request.method === "GET" && requestUrl.pathname === "/api/request-status") {
      return await getPrivateRequestStatus(request, response);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/quote") {
      return await getPrivateQuote(request, response);
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/quote/decision") {
      return await decidePrivateQuote(request, response);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/opportunity") {
      return await getPrivateCleanerOpportunity(request, response);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/opportunity-photo") {
      return await getPrivateCleanerOpportunityPhoto(request, response, text(requestUrl.searchParams.get("imageId"), 40));
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/opportunity/decision") {
      return await decidePrivateCleanerOpportunity(request, response);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/booking-pack") {
      return await getPrivateBookingPack(request, response);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/booking-photo") {
      return await getPrivateBookingPhoto(request, response, text(requestUrl.searchParams.get("imageId"), 40));
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/booking-change-requests") {
      return await createPrivateBookingChangeRequest(request, response);
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/job-events") {
      return await createPrivateJobEvent(request, response);
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
    if (request.method === "PATCH" && requestUrl.pathname === "/api/admin/booking-change-requests/status") {
      return await updateAdminBookingChangeStatus(request, response);
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
    if (request.method === "POST" && requestUrl.pathname === "/api/admin/cleaner-availability") {
      return await createAdminCleanerAvailability(request, response);
    }
    if (request.method === "PATCH" && requestUrl.pathname === "/api/admin/cleaner-availability") {
      return await withdrawAdminCleanerAvailability(request, response);
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

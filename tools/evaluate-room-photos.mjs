import { readFile, realpath, stat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { roomVisionFromEnvironment } from "../src/marketplace/room-vision.mjs";
import { benchmarkCaseErrors, runScanBenchmark } from "../src/marketplace/scan-benchmark.mjs";
import { inventoryKey } from "../public/room-scan-model.js";

const hash = value => createHash("sha256").update(value).digest("hex");
const toolPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(toolPath), "..");
const maxBytes = 4 * 1024 * 1024 - 3;
const types = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const nonempty = value => typeof value === "string" && Boolean(value.trim());

function imageType(bytes) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function emptyCase(entry) {
  return {
    caseId: entry.caseId, synthetic: entry.synthetic, consent: entry.consent,
    deviceClass: entry.deviceClass, lighting: entry.lighting, propertyType: entry.propertyType,
    truth: entry.truth, rooms: [{ roomName: entry.roomName, condition: "", objects: [] }]
  };
}

// Validate ALL entries before any provider call. Images stay outside reports and source control.
export async function preparePhotoEvaluation(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.cases) || !manifest.cases.length) {
    throw new Error("A version 1 manifest with at least one labelled photo is required.");
  }
  if (!nonempty(manifest.mediaRoot)) throw new Error("mediaRoot is required.");
  const mediaRoot = await realpath(path.resolve(path.dirname(manifestPath), manifest.mediaRoot));
  const ids = new Set();
  const prepared = [];
  for (const entry of manifest.cases) {
    if (!entry || !nonempty(entry.caseId) || ids.has(entry.caseId)) throw new Error("Case IDs must be present and unique.");
    ids.add(entry.caseId);
    const fail = message => { throw new Error(entry.caseId + ": " + message); };
    if (!nonempty(entry.roomName)) fail("roomName is required.");
    if (!["walking", "confirmation"].includes(entry.purpose)) fail("purpose must be walking or confirmation.");
    if (!nonempty(entry.image) || path.isAbsolute(entry.image)) fail("image must be relative to mediaRoot.");
    if (!nonempty(entry.deviceClass) || !nonempty(entry.lighting)) fail("deviceClass and lighting are required.");
    const truthRooms = entry.truth?.rooms;
    if (!Array.isArray(truthRooms) || truthRooms.length !== 1 || truthRooms[0]?.roomName !== entry.roomName
        || !Array.isArray(truthRooms[0]?.objects)) fail("truth must label exactly this room; use an empty objects array for an empty frame.");
    for (const item of truthRooms[0].objects) {
      if (!nonempty(item?.inventoryKey) || !inventoryKey(item.inventoryKey)) fail("every truth object needs an inventoryKey.");
      if (item.quantity !== undefined && (!Number.isSafeInteger(item.quantity) || item.quantity < 1)) fail("truth quantities must be positive integers.");
      if (item.condition !== undefined && !["", "unknown", "clean", "light", "medium", "heavy"].includes(item.condition)) fail("invalid truth condition.");
    }
    const errors = benchmarkCaseErrors(emptyCase(entry));
    if (errors.length) fail(errors.join(" "));
    if (entry.synthetic === false && !Number.isFinite(Date.parse(entry.consent?.recordedAt))) fail("consent.recordedAt must be a valid date.");
    const location = await realpath(path.resolve(mediaRoot, entry.image));
    const relative = path.relative(mediaRoot, location);
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) fail("image resolves outside mediaRoot.");
    const metadata = await stat(location);
    if (!metadata.isFile() || metadata.size === 0 || metadata.size > maxBytes) fail("image must be a nonempty file below the reader's 4 MiB limit.");
    const bytes = await readFile(location);
    const mediaType = types[path.extname(location).toLowerCase()];
    if (!mediaType || imageType(bytes) !== mediaType) fail("image signature must match JPEG, PNG or WebP extension.");
    prepared.push({
      entry, image: "data:" + mediaType + ";base64," + bytes.toString("base64"),
      imageSha256: hash(bytes), imageBytes: bytes.length, mediaType
    });
  }
  return { manifestSha256: hash(JSON.stringify(manifest)), prepared };
}

// Whole-room provider output, deliberately before tracking/merging: do not hide duplicate detections.
// This is a photo-reader diagnostic, NOT a camera, selected-item, walkthrough or booking benchmark.
export async function evaluatePhotos(plan, { reader, now = () => performance.now(), checkpoint = async () => {} } = {}) {
  if (!reader || typeof reader.readRoom !== "function") throw new Error("A configured room reader is required.");
  const cases = [];
  const reads = [];
  for (const photo of plan.prepared) {
    const entry = photo.entry;
    const result = emptyCase(entry);
    const started = now();
    let reading;
    let status = "ok";
    try {
      reading = await reader.readRoom({
        image: photo.image, roomName: entry.roomName, purpose: entry.purpose,
        transcript: entry.transcript || ""
      });
      if (!Array.isArray(reading?.detections)) throw new Error("Invalid reader result.");
      result.rooms[0] = {
        roomName: entry.roomName, condition: reading.condition || "",
        objects: reading.detections.map((item, index) => ({
          objectId: entry.caseId + "-" + index, inventoryKey: inventoryKey(item.label), label: item.label,
          quantity: 1, condition: item.condition || "", soiling: item.soiling || [],
          confidenceLabel: item.confidence ?? null, confidenceCondition: item.conditionConfidence ?? null,
          conditionConfirmed: false, evidence: item.note || "", origin: "vision"
        }))
      };
    } catch {
      // Never log provider errors, which can echo request content or credentials.
      // A failed read remains an empty observed room so it cannot improve recall by being excluded.
      status = "reader-error";
    }
    const read = {
      caseId: entry.caseId, purpose: entry.purpose,
      provider: reader.provider || "unknown", model: reader.models?.[entry.purpose] || "unknown",
      schemaVersion: reader.schemaVersion ?? null, status, elapsedMs: Math.max(0, now() - started),
      imageSha256: photo.imageSha256, imageBytes: photo.imageBytes, mediaType: photo.mediaType,
      ...(status === "ok" ? { reading } : {})
    };
    cases.push(result);
    reads.push(read);
    await checkpoint({ case: result, read });
  }
  const benchmark = runScanBenchmark(cases);
  const sorted = reads.filter(read => read.status === "ok").map(read => read.elapsedMs).sort((a, b) => a - b);
  const quantile = fraction => sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1] : null;
  const middle = Math.floor(sorted.length / 2);
  const medianMs = !sorted.length ? null : sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const failedReads = reads.filter(read => read.status !== "ok").length;
  return {
    version: 1, scope: "whole-room photo reader only; excludes camera, tracking, selected-item confirmation and UI",
    manifestSha256: plan.manifestSha256, cases, reads, benchmark,
    failedReads, completedReads: reads.length - failedReads,
    timing: { scope: "successful provider reads including SDK/network/retries; not phone latency", medianMs, p95Ms: quantile(0.95) },
    validationComplete: false,
    limitation: "A photo diagnostic cannot establish end-to-end or representative device accuracy.",
    measuredTargetsMet: failedReads === 0 && benchmark.acceptable
  };
}

export async function sourceFingerprints() {
  const paths = ["tools/evaluate-room-photos.mjs", "src/marketplace/room-vision.mjs",
    "public/room-scan-model.js", "src/marketplace/scan-benchmark.mjs"];
  return Object.fromEntries(await Promise.all(paths.map(async name => [name, hash(await readFile(path.join(root, name)))])));
}

async function main() {
  const [manifestPath, outputDirectory, flag, ...extra] = process.argv.slice(2);
  if (!manifestPath || !outputDirectory || extra.length || (flag && flag !== "--run")) {
    throw new Error("Usage: node tools/evaluate-room-photos.mjs MANIFEST OUTPUT_DIRECTORY [--run]");
  }
  const plan = await preparePhotoEvaluation(path.resolve(manifestPath));
  if (flag !== "--run") {
    console.log(JSON.stringify({ preflight: "passed", photos: plan.prepared.length,
      real: plan.prepared.filter(photo => photo.entry.synthetic === false).length,
      plannedProviderCalls: plan.prepared.length, providerCalled: false }, null, 2));
    return;
  }
  const reader = roomVisionFromEnvironment();
  if (!reader) throw new Error("Room reader unavailable. Configure ANTHROPIC_API_KEY in the environment.");
  // Require a fresh directory to prevent overwriting previous measurements.
  await mkdir(path.resolve(outputDirectory), { recursive: false });
  const sources = await sourceFingerprints();
  await writeFile(path.join(outputDirectory, "run.json"), JSON.stringify({
    startedAt: new Date().toISOString(), sources, manifestSha256: plan.manifestSha256
  }, null, 2), { flag: "wx" });
  let index = 0;
  const report = await evaluatePhotos(plan, {
    reader, checkpoint: async value => writeFile(
      path.join(outputDirectory, String(++index).padStart(4, "0") + ".json"),
      JSON.stringify(value, null, 2), { flag: "wx" })
  });
  await writeFile(path.join(outputDirectory, "report.json"), JSON.stringify({ ...report, sources }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ completedReads: report.completedReads, failedReads: report.failedReads, timing: report.timing }, null, 2));
  if (report.failedReads) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === toolPath) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { preparePhotoEvaluation, evaluatePhotos } from "../tools/evaluate-room-photos.mjs";
import { createAnthropicRoomVision } from "../src/marketplace/room-vision.mjs";

const temporary = await mkdtemp(path.join(os.tmpdir(), "homle-photo-evaluation-"));
const manifestPath = path.join(temporary, "manifest.json");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const entry = {
  caseId: "synthetic-orchestration", synthetic: true, image: "room.png",
  roomName: "Kitchen", purpose: "walking", deviceClass: "test-stub", lighting: "synthetic",
  truth: { rooms: [{ roomName: "Kitchen", objects: [{ inventoryKey: "chair", quantity: 1, condition: "light" }] }] }
};
const manifest = cases => ({ version: 1, mediaRoot: "images", cases });
const prepare = async cases => {
  await writeFile(manifestPath, JSON.stringify(manifest(cases)));
  return preparePhotoEvaluation(manifestPath);
};
try {
  await mkdir(path.join(temporary, "images"));
  await writeFile(path.join(temporary, "images", "room.png"), png);
  const plan = await prepare([entry]);
  assert.equal(plan.prepared[0].mediaType, "image/png");
  assert.equal(plan.prepared[0].imageBytes, png.length);
  assert.match(plan.prepared[0].imageSha256, /^[a-f0-9]{64}$/);
  await assert.rejects(prepare([]), /at least one/);
  await assert.rejects(prepare([entry, entry]), /unique/);
  await assert.rejects(prepare([{ ...entry, synthetic: false }]), /consent/);
  await assert.rejects(prepare([{ ...entry, purpose: "expensive" }]), /purpose/);
  await assert.rejects(prepare([{ ...entry, truth: { rooms: [] } }]), /exactly this room/);
  await assert.rejects(prepare([{ ...entry, truth: { rooms: [{ roomName: "Kitchen", objects: [{ inventoryKey: "chair", quantity: 0 }] }] } }]), /positive integers/);
  await writeFile(path.join(temporary, "outside.png"), png);
  await assert.rejects(prepare([{ ...entry, image: "../outside.png" }]), /outside mediaRoot/);
  await writeFile(path.join(temporary, "images", "wrong.jpg"), png);
  await assert.rejects(prepare([{ ...entry, image: "wrong.jpg" }]), /signature/);
  const real = { ...entry, synthetic: false, consent: { recordedAt: "2026-09-10", reference: "test-only-no-real-media" },
    truth: { ...entry.truth, labelledBy: "test fixture" } };
  await assert.rejects(prepare([{ ...real, consent: { ...real.consent, recordedAt: "nonsense" } }]), /valid date/);

  // Execute the real adapter with a fake transport. No network or real-room evidence.
  const requests = [];
  const reader = createAnthropicRoomVision({
    apiKey: "test-only", client: { messages: { create: async request => {
      requests.push(request);
      return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({
        condition: "light", tasks: [], detections: [
          { label: "Chair", condition: "light", soiling: ["dust"], labelConfidence: 0.9,
            conditionConfidence: 0.8, evidence: "visible dust", x: 0, y: 0, width: 20, height: 20 },
          { label: "Chair", condition: "unknown", soiling: [], labelConfidence: 0.85,
            conditionConfidence: 0.2, evidence: "", x: 50, y: 0, width: 20, height: 20 }
        ]
      }) }] };
    } } }
  });
  let clock = 0;
  const checkpoints = [];
  const report = await evaluatePhotos(plan, { reader, now: () => (clock += 25), checkpoint: async value => checkpoints.push(value) });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].messages[0].content[0].source.type, "base64");
  assert.equal(requests[0].model, reader.models.walking);
  assert.equal(report.cases[0].rooms[0].objects.length, 2);
  assert.equal(report.cases[0].rooms[0].objects[0].confidenceLabel, 0.9);
  assert.equal(report.cases[0].rooms[0].objects[1].confidenceCondition, 0.2);
  assert.equal(report.benchmark.metrics.objectRecall, 1);
  assert.equal(report.benchmark.metrics.objectPrecision, 0.5);
  assert.equal(report.benchmark.metrics.duplicateRate, 0.5);
  assert.equal(report.timing.medianMs, 25);
  assert.equal(report.validationComplete, false);
  assert.equal(report.measuredTargetsMet, false);
  assert.equal(checkpoints.length, 1);
  assert.ok(!JSON.stringify(report).includes("data:image"));
  assert.ok(!JSON.stringify(report).includes(png.toString("base64")));

  const confirmation = await prepare([{ ...entry, purpose: "confirmation" }]);
  await evaluatePhotos(confirmation, { reader });
  assert.equal(requests[1].model, reader.models.confirmation);
  const failure = await evaluatePhotos(plan, { reader: { readRoom: async () => { throw new Error("SECRET_REQUEST"); } } });
  assert.equal(failure.failedReads, 1);
  assert.equal(failure.benchmark.metrics.objectRecall, 0);
  assert.equal(failure.timing.medianMs, null);
  assert.ok(!JSON.stringify(failure).includes("SECRET_REQUEST"));
  const twoPhotos = await prepare([entry, { ...entry, caseId: "second-synthetic-photo" }]);
  const times = [0, 10, 10, 40];
  const timing = await evaluatePhotos(twoPhotos, {
    reader: { readRoom: async () => ({ detections: [] }) }, now: () => times.shift()
  });
  assert.equal(timing.timing.medianMs, 20);
  assert.equal(timing.timing.p95Ms, 30);
  let attempts = 0;
  const mixed = await evaluatePhotos(twoPhotos, { reader: { readRoom: async () => {
    if (++attempts === 1) throw new Error("first read failed");
    return { detections: [] };
  } } });
  assert.equal(mixed.failedReads, 1);
  assert.equal(mixed.completedReads, 1);
  assert.equal(mixed.cases.length, 2);
  await assert.rejects(evaluatePhotos(plan), /configured room reader/);
  await assert.rejects(evaluatePhotos(plan, { reader, checkpoint: async () => { throw new Error("disk full"); } }), /disk full/);
  console.log("Photo evaluation: validation, real adapter with fake transport, duplicate scoring, confidence separation, failure accounting and checkpoint tests passed. Synthetic only.");
} finally {
  if (path.dirname(temporary) !== path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith("homle-photo-evaluation-")) throw new Error("Unexpected test directory");
  await rm(temporary, { recursive: true, force: true });
}

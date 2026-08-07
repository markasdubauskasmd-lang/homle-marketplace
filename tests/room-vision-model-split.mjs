import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createAnthropicRoomVision, roomVisionFromEnvironment } from "../src/marketplace/room-vision.mjs";
import { resolveRoomCondition, roomReadingPayload } from "../public/room-scan-model.js";

// The scan makes up to five reads per room: four opportunistic ones while the
// customer walks, and one on the frame they deliberately framed and confirmed.
// Only the last produces the condition and the checklist the job is priced and
// timed from, so only the last is worth a stronger — and roughly five times
// dearer — model. These pin that the split sends each read to the right tier and,
// more importantly, that nothing a client sends can move a read to the dear one.

const walkingModel = "claude-haiku-4-5";
const confirmationModel = "claude-opus-4-8";

// Records what the provider asked for without calling anything.
function recordingClient() {
  const calls = [];
  return {
    calls,
    messages: {
      create(request) {
        calls.push(request.model);
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify({ condition: "light", detections: [], tasks: [] }) }]
        };
      }
    }
  };
}

/* ── Each read goes to its own tier ── */

{
  const client = recordingClient();
  const vision = createAnthropicRoomVision({ apiKey: "test-key", model: walkingModel, confirmationModel, client });
  await vision.readRoom({ image: "data:image/jpeg;base64,AA", roomName: "Kitchen", purpose: "walking" });
  assert.deepEqual(client.calls, [walkingModel], `A walking frame was read by ${client.calls[0]}. Up to four of these happen per room and they only need their objects named.`);
}

{
  const client = recordingClient();
  const vision = createAnthropicRoomVision({ apiKey: "test-key", model: walkingModel, confirmationModel, client });
  await vision.readRoom({ image: "data:image/jpeg;base64,AA", roomName: "Kitchen", purpose: "confirmation" });
  assert.deepEqual(client.calls, [confirmationModel], "The confirmation read did not use the confirmation tier, so the grade that sets the price came from the cheaper model.");
}

/* ── A confirmation where nothing was tapped still counts as a confirmation ── */

// This is why the split cannot key off which method was called. A customer who
// confirms a room without tapping any object comes through `readRoom`, and that
// read still produces the condition and the checklist.
{
  const client = recordingClient();
  const vision = createAnthropicRoomVision({ apiKey: "test-key", model: walkingModel, confirmationModel, client });
  await vision.readRoom({ image: "data:image/jpeg;base64,AA", roomName: "Kitchen", purpose: "confirmation" });
  assert.deepEqual(client.calls, [confirmationModel], "A confirmation with no tapped objects fell back to the walking tier, so the read that sets the price was answered by the cheaper model.");
}

/* ── Nothing a client sends can escalate the cost ── */

// `purpose` arrives in a request body. A value that selects a five-times-dearer
// model is a way to run up someone else's bill, so anything unrecognised must
// land on the cheaper tier. It can never escalate, only stay cheap.
for (const hostile of [undefined, null, "", "CONFIRMATION", " confirmation", "confirm", "expensive", "opus", 1, true, {}, ["confirmation"]]) {
  const client = recordingClient();
  const vision = createAnthropicRoomVision({ apiKey: "test-key", model: walkingModel, confirmationModel, client });
  await vision.readRoom({ image: "data:image/jpeg;base64,AA", roomName: "Kitchen", purpose: hostile });
  assert.deepEqual(client.calls, [walkingModel], `A purpose of ${JSON.stringify(hostile)} selected the dearer model. Only the exact string "confirmation" may.`);
}

// The route normalises before the provider ever sees it, so both layers reject.
const route = readFileSync(new URL("../src/marketplace/marketplace-http.mjs", import.meta.url), "utf8");
assert.match(route, /body\?\.purpose === "confirmation" \? "confirmation" : "walking"/, "The room-reading route passes `purpose` through instead of comparing it to the exact string, so an arbitrary value reaches the model selector.");

/* ── Unset means the split is ON ── */

// The split is opt-out. A deployment that configures nothing gets the stronger
// tier on the read that sets the price — that read grades soiling, which is fine
// detail, and it is one call per room against four walking frames.
{
  const client = recordingClient();
  const vision = createAnthropicRoomVision({ apiKey: "test-key", model: walkingModel, client });
  await vision.readRoom({ image: "data:image/jpeg;base64,AA", roomName: "Kitchen", purpose: "confirmation" });
  await vision.readRoom({ image: "data:image/jpeg;base64,AA", roomName: "Kitchen", purpose: "walking" });
  assert.deepEqual(client.calls, ["claude-opus-4-8", walkingModel], "With no confirmation tier configured, the price-setting read did not get the stronger tier.");
}

// And it is genuinely opt-out, not merely defaulted: naming the walking model
// explicitly puts both reads back on one tier.
{
  const client = recordingClient();
  const vision = createAnthropicRoomVision({ apiKey: "test-key", model: walkingModel, confirmationModel: walkingModel, client });
  await vision.readRoom({ image: "data:image/jpeg;base64,AA", roomName: "Kitchen", purpose: "confirmation" });
  assert.deepEqual(client.calls, [walkingModel], "The confirmation tier cannot be turned off by naming the walking model, so a deployment cannot opt back out of the spend.");
}

// A blank configuration now selects the dearer tier for the confirmation read.
// That inverts what this test previously guarded, and it is deliberate: the read
// that grades soiling is the one the price is calculated from, and grading a
// dust film or a grease sheen is a resolution problem before it is a reasoning
// one. It is bounded — one call per room against four walking frames, and the
// walking frames stay on the cheap tier below.
//
// This is the assertion that fails first if someone changes the default back, so
// the cost of a blank deployment is stated here in one place rather than being
// discovered on a bill.
{
  const client = recordingClient();
  const vision = createAnthropicRoomVision({ apiKey: "test-key", client });
  await vision.readRoom({ image: "data:image/jpeg;base64,AA", roomName: "Kitchen", purpose: "confirmation" });
  assert.deepEqual(client.calls, ["claude-opus-4-8"], `With no models configured the confirmation read used ${client.calls[0]}, not the tier that can resolve soiling.`);
}

// The walking frames are the volume, and they stay cheap. If this ever flips to
// the dearer tier the per-scan cost multiplies by roughly four, because these
// are the reads there are four of.
{
  const client = recordingClient();
  const vision = createAnthropicRoomVision({ apiKey: "test-key", client });
  await vision.readRoom({ image: "data:image/jpeg;base64,AA", roomName: "Kitchen", purpose: "walking" });
  assert.deepEqual(client.calls, ["claude-haiku-4-5"], `A walking frame used ${client.calls[0]}. These are four-per-room and only their label is kept; they must stay on the cheap tier.`);
}

assert.equal(roomVisionFromEnvironment({ ANTHROPIC_API_KEY: "" }), null, "A missing key no longer disables the reader.");

/* ── The client says which read it is ── */

assert.equal(roomReadingPayload({ roomName: "Kitchen", roomFrame: "data:image/jpeg;base64,AA", purpose: "walking" }).body.purpose, "walking", "The payload does not carry the walking purpose, so every read would be priced as a confirmation.");
assert.equal(roomReadingPayload({ roomName: "Kitchen", roomFrame: "data:image/jpeg;base64,AA", purpose: "confirmation" }).body.purpose, "confirmation", "The payload does not carry the confirmation purpose.");
assert.equal(roomReadingPayload({ roomName: "Kitchen", roomFrame: "data:image/jpeg;base64,AA", purpose: "opus" }).body.purpose, "walking", "The payload passed an unrecognised purpose through rather than normalising it to the cheap tier.");

/* ── The grade that was paid for is the grade that is used ── */

// Worst-wins across every read was defensible while all reads used one model. It
// stops being defensible the moment the confirmation is the stronger tier: one
// jumpy "heavy" from a passing glance would override the calibrated grade, and
// because worst-wins is one-directional the error only ever runs towards
// over-charging.
assert.equal(resolveRoomCondition("medium", "heavy"), "medium", "A walking glance overrode the confirmation grade. Once the tiers differ, that lets the cheaper model override the dearer one — and only ever upwards, towards over-charging.");
assert.equal(resolveRoomCondition("heavy", "light"), "heavy", "The confirmation grade was not authoritative.");

// ...but coverage still counts when the confirmation could not judge. A frame
// taken from a doorway can genuinely fail to show what a walk around the room saw.
assert.equal(resolveRoomCondition("unknown", "heavy"), "heavy", "A confirmation that could not judge discarded what the walk observed, losing the coverage the walk exists to provide.");
assert.equal(resolveRoomCondition("", "medium"), "medium", "A missing confirmation grade discarded the observed one.");
assert.equal(resolveRoomCondition("unknown", "unknown"), "", "Two unknowns produced a grade.");
assert.equal(resolveRoomCondition("", ""), "", "Empty input produced a grade.");
assert.equal(resolveRoomCondition("HEAVY", "light"), "heavy", "Grades are not compared case-insensitively.");

console.log("Room vision model split tests passed: walking frames use the cheap tier and confirmations the configured one, a confirmation with no tapped objects is still a confirmation, no client-supplied purpose can escalate to the dearer model, an unset confirmation tier puts the price-setting read on the stronger model, and the confirmation grade is authoritative except where it could not judge.");

/* ── The instruction block is cached, and effort follows the read ── */

const visionSource = readFileSync(new URL("../src/marketplace/room-vision.mjs", import.meta.url), "utf8");

// The instruction block is the largest part of every request and is byte-identical
// on every call. Sending it uncached re-bills the whole prefix per photograph, and
// a room is five reads.
assert.match(visionSource, /cache_control: \{ type: "ephemeral" \}/, "The instruction block is sent without cache_control, so the largest and most repeated part of every request is re-billed per photograph.");
for (const call of ["system: cachedSystem(instructions)", "system: cachedSystem(selectionInstructions)"]) {
  assert(visionSource.includes(call), `A read still sends its system prompt as a bare string (${call} missing), so cache_control never reaches it.`);
}

// Caching is silent when it fails: a prefix below the model's minimum is not an
// error, it just never caches. The probe is what turns that into a number, so it
// has to keep existing and keep being reachable.
assert(existsSync(new URL("../tools/room-vision-probe.mjs", import.meta.url)), "tools/room-vision-probe.mjs is gone, so nothing measures whether the cached prefix actually clears the per-model minimum.");
assert.match(visionSource, /room-vision-probe\.mjs/, "room-vision.mjs no longer points at the probe, so the next reader has no way to find out whether its cache_control does anything.");

// Depth follows the read, not the model. A walking frame is recognition and its
// coordinates are discarded; the confirmation read is judgement and sets the price.
assert.match(visionSource, /effort: purpose === "confirmation" \? "high" : "low"/, "Effort is no longer chosen per read, so either the four discarded walking frames are paying for depth or the read that sets the price is not getting it.");
// Haiku rejects the parameter outright, so the capability gate has to stay.
assert.match(visionSource, /const supportsEffort = /, "The effort capability gate was removed; sending effort to a model that rejects it 400s every call on that tier.");
assert.match(visionSource, /opus-\[5-9\]/, "The effort gate does not recognise the current Opus line, so a deployment on it would silently lose the effort hint.");

console.log("Room vision model-split tests passed: price-setting read on the resolving tier, walking frames cheap, prompt caching wired, effort per read.");

/* ── The configured tiers are visible without reading a scan record ── */

// `roomVisionReady: true` says a reader is configured. It does not say which
// model answers the read that sets the price — and ROOM_VISION_CONFIRMATION_MODEL
// can pin that back to the cheap tier with no other symptom: scans still work,
// boxes still appear, grading is just quietly worse. Publishing the resolved
// tiers turns a silent misconfiguration into something checkable in a browser.
const runtimeSource = readFileSync(new URL("../src/marketplace/runtime.mjs", import.meta.url), "utf8");
const attachmentSource = readFileSync(new URL("../src/marketplace/attachment.mjs", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");

assert.match(runtimeSource, /roomVisionModels: roomVision\?\.models \|\| null/, "The runtime no longer surfaces which models the reader resolved to.");
assert.match(attachmentSource, /roomVisionModels: runtime\.roomVisionModels \|\| null/, "The attachment drops the resolved models, so health cannot report them.");
// The disabled default has to carry the key too, or a deployment with no reader
// returns a differently-shaped health body than one with a reader.
assert.match(attachmentSource, /roomVisionReady: false,\s*\n\s*roomVisionModels: null/, "The disabled attachment omits roomVisionModels, so the health shape changes depending on configuration.");
assert.match(serverSource, /roomVisionModels: marketplaceAttachment\.roomVisionModels \|\| null/, "The health endpoint no longer publishes the resolved reader tiers.");

// The provider is what produces the record, so it has to keep exposing it.
{
  const client = recordingClient();
  const configured = createAnthropicRoomVision({ apiKey: "test-key", client });
  assert.deepEqual(configured.models, { walking: "claude-haiku-4-5", confirmation: "claude-opus-4-8" }, `The provider reports ${JSON.stringify(configured.models)}, which is not what health would publish.`);
}
{
  const client = recordingClient();
  const pinned = createAnthropicRoomVision({ apiKey: "test-key", confirmationModel: "claude-haiku-4-5", client });
  assert.equal(pinned.models.confirmation, "claude-haiku-4-5", "A pinned confirmation tier is not reflected in the published models, so the check would report the intended tier while the cheap one actually answers.");
}

console.log("Health now publishes the resolved reader tiers, so a pinned confirmation model is visible without reading a scan record.");

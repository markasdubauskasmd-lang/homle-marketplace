import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

/* ── Unset means nothing changes ── */

// The split is opt-in. A deployment that has not chosen a confirmation tier must
// behave exactly as it did before this existed.
{
  const client = recordingClient();
  const vision = createAnthropicRoomVision({ apiKey: "test-key", model: walkingModel, client });
  await vision.readRoom({ image: "data:image/jpeg;base64,AA", roomName: "Kitchen", purpose: "confirmation" });
  await vision.readRoom({ image: "data:image/jpeg;base64,AA", roomName: "Kitchen", purpose: "walking" });
  assert.deepEqual(client.calls, [walkingModel, walkingModel], "With no confirmation tier configured, reads diverged. Unset must mean today's behaviour exactly.");
}

// And the default is still the cheap tier, not whatever the environment omitted.
{
  const client = recordingClient();
  const vision = createAnthropicRoomVision({ apiKey: "test-key", client });
  await vision.readRoom({ image: "data:image/jpeg;base64,AA", roomName: "Kitchen", purpose: "confirmation" });
  assert.deepEqual(client.calls, [walkingModel], `With no models configured at all the reader used ${client.calls[0]}. A blank configuration must never select the dearer tier.`);
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

console.log("Room vision model split tests passed: walking frames use the cheap tier and confirmations the configured one, a confirmation with no tapped objects is still a confirmation, no client-supplied purpose can escalate to the dearer model, an unset confirmation tier behaves exactly as before, and the confirmation grade is authoritative except where it could not judge.");

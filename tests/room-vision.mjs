import { createAnthropicRoomVision, roomVisionFromEnvironment } from "../src/marketplace/room-vision.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
async function rejects(run, fragment) {
  try { await run(); } catch (error) { return String(error?.message || "").includes(fragment); }
  return false;
}

const pixel = "data:image/jpeg;base64," + "A".repeat(64);
const stub = (reply, capture = {}) => ({
  messages: {
    async create(request) {
      Object.assign(capture, { request });
      return typeof reply === "function" ? reply(request) : reply;
    }
  }
});
const jsonReply = (payload) => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(payload) }] });

// Optional capability: absent configuration must leave the scan working without
// detections rather than failing the runtime.
assert(roomVisionFromEnvironment({}) === null, "An unconfigured room vision provider was not treated as disabled.");
assert(roomVisionFromEnvironment({ ROOM_VISION_PROVIDER: "off" }) === null, "An explicitly disabled room vision provider was still constructed.");
assert(await rejects(async () => roomVisionFromEnvironment({ ROOM_VISION_PROVIDER: "acme" }), "must be 'anthropic'"), "An unrecognised room vision provider was accepted.");
assert(await rejects(async () => roomVisionFromEnvironment({ ROOM_VISION_PROVIDER: "anthropic" }), "ANTHROPIC_API_KEY is required"), "The provider was enabled without the credential it needs.");

{
  const capture = {};
  const vision = createAnthropicRoomVision({
    apiKey: "test-key",
    client: stub(jsonReply({
      condition: "heavy",
      detections: [
        { label: "Worktop", note: "grease", x: 10, y: 55, width: 46, height: 20 },
        { label: "Hob", note: "burnt on", x: 60, y: 50, width: 20, height: 18 }
      ],
      tasks: ["Degrease the worktops", "Remove burnt-on residue from the hob"]
    }), capture)
  });
  const result = await vision.readRoom({ image: pixel, roomName: "Kitchen", transcript: "the oven is bad" });
  assert(result.condition === "heavy" && result.detections.length === 2 && result.tasks.length === 2, `A valid reading was not returned intact: ${JSON.stringify(result)}`);

  // The request must carry the photograph and the room context, and nothing else.
  const content = capture.request.messages[0].content;
  assert(content[0].type === "image" && content[0].source.type === "base64" && content[0].source.media_type === "image/jpeg", "The photograph was not sent as a bounded base64 image.");
  assert(content[1].type === "text" && content[1].text.includes("Kitchen"), "The room context was not sent with the photograph.");
  assert(capture.request.output_config.format.type === "json_schema", "The reading was requested without a schema.");
}

// A box that does not fit the frame is dropped rather than clamped: a clamped
// box would be drawn confidently over the wrong part of the room.
{
  const vision = createAnthropicRoomVision({
    apiKey: "test-key",
    client: stub(jsonReply({
      condition: "light",
      detections: [
        { label: "Good", note: "", x: 5, y: 5, width: 10, height: 10 },
        { label: "Overflows", note: "", x: 95, y: 5, width: 20, height: 10 },
        { label: "Negative", note: "", x: -5, y: 5, width: 10, height: 10 },
        { label: "", note: "", x: 5, y: 5, width: 10, height: 10 }
      ],
      tasks: ["Dust the shelves"]
    }))
  });
  const result = await vision.readRoom({ image: pixel, roomName: "Living room" });
  assert(result.detections.length === 1 && result.detections[0].label === "Good", `Malformed detections were not dropped: ${JSON.stringify(result.detections)}`);
}

// Only images, and only bounded ones.
assert(await rejects(async () => createAnthropicRoomVision({ apiKey: "k", client: stub(jsonReply({ condition: "light", detections: [], tasks: [] })) }).readRoom({ image: "not-an-image" }), "captured room photograph is required"), "A non-image payload was sent to the provider.");
assert(await rejects(async () => createAnthropicRoomVision({ apiKey: "k", client: stub(jsonReply({ condition: "light", detections: [], tasks: [] })) }).readRoom({ image: "data:image/jpeg;base64," + "A".repeat(9_000_000) }), "too large"), "An unbounded photograph was sent to the provider.");

// Every provider fault must throw cleanly so the scan continues without
// detections instead of showing the Landlord a broken room.
for (const [label, reply] of [
  ["a safety refusal", { stop_reason: "refusal", content: [] }],
  ["invalid JSON", { stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }]
]) {
  const vision = createAnthropicRoomVision({ apiKey: "test-key", client: stub(reply) });
  let threw = false;
  try { await vision.readRoom({ image: pixel, roomName: "Kitchen" }); } catch { threw = true; }
  assert(threw, `${label} did not fail cleanly.`);
}

// An empty reading is legitimate — a room may genuinely have nothing notable.
{
  const vision = createAnthropicRoomVision({ apiKey: "test-key", client: stub(jsonReply({ condition: "light", detections: [], tasks: [] })) });
  const result = await vision.readRoom({ image: pixel, roomName: "Hallway" });
  assert(result.detections.length === 0 && result.condition === "light", "An empty but valid reading was rejected.");
}

// The prompt must forbid the one thing a photograph cannot support.
const { default: source } = await import("node:fs").then((fs) => ({ default: fs.readFileSync(new URL("../src/marketplace/room-vision.mjs", import.meta.url), "utf8") }));
assert(source.includes("Never estimate floor area"), "The reader is not told to refuse measurements it cannot take from a photograph.");
assert(source.includes("Do not describe people"), "The reader is not told to leave people and identifying detail out of a photograph of someone's home.");

console.log("Room vision tests passed: optional capability, photograph-only bounded requests, malformed-box rejection, honest empty readings, no invented measurement and clean failure for every provider fault.");

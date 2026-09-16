import assert from "node:assert/strict";
import { createReadingPreview } from "../src/marketplace/room-reading-preview.mjs";
import { readRoomResponse } from "../public/room-reading-stream.js";
import { createAnthropicRoomVision } from "../src/marketplace/room-vision.mjs";
const detection = (label, overrides = {}) => ({ label, labelConfidence: .9, condition: "clean", conditionConfidence: 1,
  evidence: "must not leak", tasks: ["must not leak"], x: 1, y: 2, width: 30, height: 20, ...overrides });
const objects = [detection('Shelf with "quotes", } and \\ slash'), detection("Basin")];
const payload = JSON.stringify({ condition: "unknown", detections: objects, tasks: ["later"], taskLinks: [] });
for (let split = 0; split <= payload.length; split++) {
  const result = [], parser = createReadingPreview(item => result.push(item));
  parser.push(payload.slice(0, split)); parser.push(payload.slice(split));
  assert.deepEqual(result.map(item => item.label), objects.map(item => item.label));
  assert.deepEqual(Object.keys(result[0]).sort(), ["index", "label", "labelConfidence", "x", "y", "width", "height"].sort());
}
{
  const result = [], parser = createReadingPreview(item => result.push(item));
  const first = '{"condition":"unknown","detections":[' + JSON.stringify(objects[0]);
  for (const character of first.slice(0, -1)) parser.push(character);
  assert.equal(result.length, 0, "Incomplete object must not appear");
  parser.push("}");
  assert.equal(result.length, 1, "First object appears before response completes");
  parser.push("," + JSON.stringify(objects[1]) + '],"tasks":[],"taskLinks":[]}');
  assert.equal(result.length, 2);
}
for (const invalid of [
  '{"notes":"\\\"detections\\\":[{}]","other":[' + JSON.stringify(objects[0]) + "]}",
  JSON.stringify({ wrapper: { detections: objects } }),
  '{bad,"detections":[' + JSON.stringify(objects[0]) + "]}",
  JSON.stringify({ detections: [detection("Bad", { labelConfidence: 0.2 }), detection("Bad box", { width: 101 })] })
]) {
  const result = [], parser = createReadingPreview(item => result.push(item));
  parser.push(invalid); assert.equal(result.length, 0);
}
{
  const result = [], parser = createReadingPreview(item => result.push(item));
  parser.push(JSON.stringify({ detections: Array.from({ length: 45 }, (_, i) => detection("Item " + i)) }));
  assert.equal(result.length, 40);
  const limited = createReadingPreview(() => assert.fail("oversize preview"));
  limited.push(" ".repeat(65537)); limited.push(payload);
  createReadingPreview(() => { throw Error("UI disconnected"); }).push(payload);
}
console.log("PASS: preview precedes final response; arbitrary chunk boundaries, escaping, field isolation, malformed/nested input, bounds and callback failures.");

for (const purpose of ["walking", "confirmation"]) {
  let emit, finish, emitted = false;
  const previews = [];
  const final = new Promise(resolve => { finish = resolve; });
  const controller = new AbortController();
  const provider = createAnthropicRoomVision({ apiKey: "test", client: { messages: {
    stream(request, options) {
      assert.equal(options.signal, controller.signal);
      assert.equal(request.model, purpose === "walking" ? "claude-haiku-4-5" : "claude-opus-4-8");
      return { on(event, callback) { assert.equal(event, "text"); emit = callback; }, finalMessage() { return final; } };
    }, create() { assert.fail("Streaming must not start a second request"); }
  } } });
  const read = provider.readRoom({ image: "data:image/jpeg;base64," + "A".repeat(64), purpose, signal: controller.signal, onPreview: item => previews.push(item) });
  read.then(() => { emitted = true; }, () => {});
  emit('{"condition":"unknown","detections":[' + JSON.stringify(objects[0]));
  assert.equal(previews.length, 1); assert.equal(emitted, false);
  finish({ stop_reason: "max_tokens", content: [{ type: "text", text: payload }] });
  await assert.rejects(read, /did not finish/);
  // A useful partial display must never turn a truncated provider answer into
  // a successful final assessment.
}

{
  const previews = []; let controller, resolved = false;
  const body = new ReadableStream({ start(value) { controller = value; } });
  const encoder = new TextEncoder();
  const response = new Response(body, { headers: { "content-type": "application/x-ndjson" } });
  const read = readRoomResponse(response, item => previews.push(item));
  read.then(() => { resolved = true; });
  const first = JSON.stringify({ type: "preview", item: { index: 0, label: "Étagère", condition: "clean" } }) + "\n";
  for (const byte of encoder.encode(first)) controller.enqueue(new Uint8Array([byte]));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(previews, [{ index: 0, label: "Étagère" }]); assert.equal(resolved, false);
  const result = { ok: true, detections: objects, tasks: [], condition: "unknown" };
  controller.enqueue(encoder.encode(JSON.stringify({ type: "complete", result }) + "\n")); controller.close();
  assert.deepEqual(await read, result);
  for (const text of [first, first + '{"type":"error"}\n', '{"type":"complete","result":{"ok":true}}\n{"type":"preview"}\n']) {
    await assert.rejects(readRoomResponse(new Response(text, { headers: { "content-type": "application/x-ndjson" } })));
  }
  assert.deepEqual(await readRoomResponse(new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } })), result);
}
console.log("PASS: provider streams once, preserves final rejection; browser receives early names, strips grades, rejects incomplete/error streams and retains JSON compatibility.");

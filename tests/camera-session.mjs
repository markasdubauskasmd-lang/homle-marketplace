import assert from "node:assert/strict";
import { createCameraSession } from "../public/camera-session.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fakeStream() {
  let stops = 0;
  return { getTracks: () => [{ stop() { stops += 1; } }], get stops() { return stops; } };
}
const nextMicrotasks = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

{
  const request = deferred(), late = fakeStream();
  const session = createCameraSession({ getUserMedia: () => request.promise, timeoutMs: 10 });
  await assert.rejects(session.acquire({ video: true }), { name: "CameraNotReadyError" });
  request.resolve(late); await nextMicrotasks();
  assert.equal(late.stops, 1, "A permission result arriving after timeout must release the camera");
}
{
  const first = deferred(), oldStream = fakeStream(), replacement = fakeStream();
  let requests = 0;
  const session = createCameraSession({ getUserMedia: () => ++requests === 1 ? first.promise : replacement });
  const oldResult = session.acquire({ video: true });
  const rejectedOld = assert.rejects(oldResult, { name: "AbortError" });
  await nextMicrotasks();
  assert.equal(await session.acquire({ video: true }), replacement);
  await rejectedOld;
  first.resolve(oldStream); await nextMicrotasks();
  assert.equal(oldStream.stops, 1);
  assert.equal(replacement.stops, 0, "An abandoned request cannot release the replacement stream");
  let plays = 0;
  await session.play({ play: async () => { plays++; } }, replacement);
  assert.equal(plays, 1);
  session.stop(); session.stop();
  assert.equal(replacement.stops, 1, "Repeated stop releases the active stream once");
}
{
  const stream = fakeStream(), retryStream = fakeStream(), playback = deferred();
  let requests = 0;
  const session = createCameraSession({ getUserMedia: async () => ++requests === 1 ? stream : retryStream, playbackTimeoutMs: 10 });
  await session.acquire({ video: true });
  await assert.rejects(session.play({ play: () => playback.promise }, stream), { name: "CameraNotReadyError" });
  assert.equal(stream.stops, 1, "A playback timeout releases the unusable stream");
  assert.equal(await session.acquire({ video: true }), retryStream);
  playback.resolve(); await nextMicrotasks();
  assert.equal(retryStream.stops, 0, "Late playback completion cannot stop a retry");
  await session.play({ play: async () => {} }, retryStream);
  session.stop();
}
{
  const stream = fakeStream(); let closed = false;
  const request = deferred();
  const session = createCameraSession({ getUserMedia: () => request.promise, isCancelled: () => closed });
  const opening = session.acquire({ video: true });
  await nextMicrotasks(); closed = true; request.resolve(stream);
  await assert.rejects(opening, { name: "AbortError" });
  assert.equal(stream.stops, 1, "Closing during permission acquisition releases a late stream");
  await assert.rejects(session.acquire({ video: true }), { name: "AbortError" });
}
{
  const denied = Object.assign(new Error("permission denied"), { name: "NotAllowedError" });
  const session = createCameraSession({ getUserMedia: async () => { throw denied; } });
  await assert.rejects(session.acquire({ video: true }), error => error === denied,
    "Permission errors retain their original type for the existing recovery UI");
}
{
  const stream = fakeStream(), pending = deferred();
  const session = createCameraSession({ getUserMedia: async () => stream });
  await session.acquire({ video: true });
  const playing = session.play({ play: () => pending.promise }, stream);
  const rejected = assert.rejects(playing, { name: "AbortError" });
  await nextMicrotasks(); session.stop(); await rejected;
  pending.reject(new Error("late browser interruption")); await nextMicrotasks();
  assert.equal(stream.stops, 1, "Backgrounding during playback releases the camera immediately");
}
console.log("Camera session: acquisition/play deadlines, late streams, replacement, permission errors and stop recovery passed.");

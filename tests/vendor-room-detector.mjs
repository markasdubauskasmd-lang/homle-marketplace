import { readFile } from "node:fs/promises";
import { quantizeTensor, quantizeManifest, detectorProvenance } from "../tools/vendor-room-detector.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }

/* ── The quantisation itself ────────────────────────── */

// Every value must survive the round trip to within half a bucket. If this
// drifts, the detector silently gets worse and nothing else would catch it.
{
  const values = Float32Array.from({ length: 4096 }, (_, index) => Math.sin(index / 7) * 3.5 - 0.25);
  const { quantized, scale, min } = quantizeTensor(values);
  let worst = 0;
  for (const [index, value] of values.entries()) {
    worst = Math.max(worst, Math.abs((quantized[index] * scale + min) - value));
  }
  assert(worst <= scale / 2 + 1e-6, `Quantisation lost more than half a bucket: ${worst} against a bucket of ${scale}.`);
  assert(quantized.length === values.length, "Quantisation changed the number of weights.");
}

// A tensor with no range still dequantizes to the value it held.
{
  const { quantized, scale, min } = quantizeTensor(Float32Array.from({ length: 8 }, () => 2.5));
  assert(scale === 0 && min === 2.5 && quantized.every((value) => value === 0), "A constant tensor was not preserved.");
}

// Non-finite weights must not poison the range for every other value.
{
  const { scale, min } = quantizeTensor(Float32Array.from([0, 1, Number.NaN, Number.POSITIVE_INFINITY]));
  assert(Number.isFinite(scale) && Number.isFinite(min) && min === 0, "A non-finite weight destroyed the tensor's range.");
}

/* ── What gets quantised and what is left alone ─────── */

{
  const large = 2048;
  const manifest = [{
    paths: ["shard"],
    weights: [
      { name: "big", shape: [large], dtype: "float32" },
      { name: "bias", shape: [4], dtype: "float32" },
      { name: "counts", shape: [4], dtype: "int32" }
    ]
  }];
  const source = Buffer.alloc(large * 4 + 4 * 4 + 4 * 4);
  for (let index = 0; index < large; index += 1) source.writeFloatLE(index / 100, index * 4);
  for (let index = 0; index < 4; index += 1) source.writeFloatLE(index + 0.5, large * 4 + index * 4);
  for (let index = 0; index < 4; index += 1) source.writeInt32LE(index * 11, large * 4 + 16 + index * 4);

  const { groups, data } = quantizeManifest(manifest, source);
  const [big, bias, counts] = groups[0].weights;

  assert(big.quantization?.dtype === "uint8", "A large float32 tensor was not quantised.");
  // Small tensors contribute almost nothing to the total and are where
  // quantisation actually hurts, so they must be left exactly as they were.
  assert(!bias.quantization, "A small tensor was quantised for no meaningful saving.");
  assert(!counts.quantization, "An integer tensor was quantised.");

  // Layout must still be readable: 1 byte each for the quantised tensor, 4 for
  // the rest, in the original order.
  assert(data.length === large + 16 + 16, `The quantised layout is the wrong size: ${data.length}`);
  assert(data.readFloatLE(large) === 0.5, "A tensor left as float32 was corrupted or misplaced.");
  assert(data.readInt32LE(large + 16 + 11 * 0) === 0 && data.readInt32LE(large + 16 + 12) === 33, "An integer tensor was corrupted or misplaced.");
}

// A manifest that does not account for every byte means the layout was
// misunderstood, and a silently misread model would simply detect nothing.
{
  let threw = false;
  try { quantizeManifest([{ paths: ["s"], weights: [{ name: "a", shape: [2], dtype: "float32" }] }], Buffer.alloc(64)); } catch { threw = true; }
  assert(threw, "A manifest that does not match its shards was accepted.");
}

/* ── What actually shipped ──────────────────────────── */

const model = JSON.parse(await readFile(new URL("../public/vendor/coco-ssd/model.json", import.meta.url), "utf8"));

// The vendored model must be self-contained. A leftover absolute URL would be
// blocked by connect-src 'self' and the detector would simply never load.
assert(!/https?:\/\//.test(JSON.stringify(model.weightsManifest)), "The vendored model still points at an off-origin weight file.");
assert(model.weightsManifest.length === 1 && model.weightsManifest[0].paths.every((path) => /^weights-\d+\.bin$/.test(path)), `The vendored weight manifest is not the expected local shard list: ${JSON.stringify(model.weightsManifest[0]?.paths)}`);
assert(model.weightsManifest[0].weights.some((weight) => weight.quantization?.dtype === "uint8"), "The vendored model was shipped unquantised.");
assert(detectorProvenance.model === "ssdlite_mobilenet_v2" && detectorProvenance.library["@tensorflow/tfjs-core"], "The vendored detector no longer records where it came from.");

console.log("Vendored room detector tests passed: quantisation accurate to half a bucket, constants and integers preserved, small tensors left alone, layout accounted for byte by byte, and a self-contained same-origin model.");

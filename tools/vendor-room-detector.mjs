import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Prepares the on-device room detector for `public/vendor/`.
//
// Why this exists at all: the app's Content-Security-Policy is `script-src
// 'self'` with `connect-src 'self'`, so neither the library nor the model may be
// fetched from a CDN. Everything the detector needs is served from this origin,
// which also means no third party learns which homes are being scanned.
//
// Why it quantizes: the published COCO-SSD weights are float32 and total about
// 16.4 MB. That is a lot to push to a Landlord's phone. Storing each large
// tensor as uint8 with a per-tensor scale and offset — a format TensorFlow.js
// reads natively, with no runtime change — brings it to roughly a quarter of
// that. Small tensors are deliberately left alone: they contribute almost
// nothing to the total, and quantizing a scalar or a bias is where accuracy
// actually gets hurt.
//
// Reproduce the inputs with:
//   npm pack @tensorflow/tfjs-core@4.22.0 @tensorflow/tfjs-converter@4.22.0 \
//            @tensorflow/tfjs-backend-webgl@4.22.0 @tensorflow-models/coco-ssd@2.2.3
//   curl -O https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/model.json
//   (plus the five group1-shard*of5 files listed in its weightsManifest)
//
// Run:  node tools/vendor-room-detector.mjs <source-model-dir> [output-dir]

export const detectorProvenance = Object.freeze({
  library: Object.freeze({
    "@tensorflow/tfjs-core": "4.22.0",
    "@tensorflow/tfjs-converter": "4.22.0",
    "@tensorflow/tfjs-backend-webgl": "4.22.0",
    "@tensorflow-models/coco-ssd": "2.2.3"
  }),
  model: "ssdlite_mobilenet_v2",
  modelSource: "https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/model.json",
  licence: "Apache-2.0"
});

const bytesPerElement = Object.freeze({ float32: 4, int32: 4, bool: 1, uint8: 1 });
// Below this a tensor is left as float32. The saving is negligible and the
// accuracy cost is not.
const minimumElementsToQuantize = 1024;
const shardBytes = 4 * 1024 * 1024;

function elementCount(shape) {
  return (Array.isArray(shape) ? shape : []).reduce((total, dimension) => total * dimension, 1);
}

export function quantizeTensor(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 0; }
  // A constant tensor has no range to spread across 256 buckets; every entry
  // dequantizes back to `min`, which is exactly right.
  const scale = max === min ? 0 : (max - min) / 255;
  const quantized = new Uint8Array(values.length);
  for (const [index, value] of values.entries()) {
    if (!Number.isFinite(value)) { quantized[index] = 0; continue; }
    const bucket = scale === 0 ? 0 : Math.round((value - min) / scale);
    quantized[index] = Math.max(0, Math.min(255, bucket));
  }
  return { quantized, scale, min };
}

export function quantizeManifest(manifest, source) {
  const output = [];
  const groups = [];
  let offset = 0;
  for (const group of manifest) {
    const weights = [];
    for (const weight of group.weights) {
      const count = elementCount(weight.shape);
      const width = bytesPerElement[weight.dtype] ?? 4;
      const raw = source.subarray(offset, offset + count * width);
      offset += count * width;

      if (weight.dtype !== "float32" || count < minimumElementsToQuantize) {
        output.push(Buffer.from(raw));
        weights.push(weight);
        continue;
      }
      const values = new Float32Array(raw.buffer, raw.byteOffset, count);
      const { quantized, scale, min } = quantizeTensor(values);
      output.push(Buffer.from(quantized.buffer, quantized.byteOffset, quantized.length));
      weights.push({ ...weight, quantization: { dtype: "uint8", scale, min } });
    }
    groups.push({ ...group, weights });
  }
  if (offset !== source.length) throw new Error(`The weight manifest describes ${offset} bytes but the shards hold ${source.length}.`);
  return { groups, data: Buffer.concat(output) };
}

async function main() {
  const [sourceDirectory, outputDirectory] = process.argv.slice(2);
  if (!sourceDirectory) throw new TypeError("Usage: node tools/vendor-room-detector.mjs <source-model-dir> [output-dir]");
  const destination = outputDirectory || fileURLToPath(new URL("../public/vendor/coco-ssd/", import.meta.url));

  const model = JSON.parse(await readFile(resolve(sourceDirectory, "model.json"), "utf8"));
  const shardNames = model.weightsManifest.flatMap((group) => group.paths);
  const shards = await Promise.all(shardNames.map((name) => readFile(resolve(sourceDirectory, name))));
  const source = Buffer.concat(shards);

  const { groups, data } = quantizeManifest(model.weightsManifest, source);

  await mkdir(destination, { recursive: true });

  const paths = [];
  const written = [];
  for (let start = 0; start < data.length; start += shardBytes) {
    const name = `weights-${paths.length + 1}.bin`;
    paths.push(name);
    written.push(writeFile(resolve(destination, name), data.subarray(start, start + shardBytes)));
  }
  // One group with every shard listed: the loader concatenates them in order.
  const quantizedModel = { ...model, weightsManifest: [{ paths, weights: groups.flatMap((group) => group.weights) }] };

  await Promise.all(written);
  await writeFile(resolve(destination, "model.json"), `${JSON.stringify(quantizedModel)}\n`);

  const files = await readdir(destination);
  const sizes = await Promise.all(files.map(async (name) => (await readFile(resolve(destination, name))).length));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  console.log(`Vendored ${detectorProvenance.model}: ${source.length} bytes of weights became ${data.length}, ${files.length} files, ${(total / 1024 / 1024).toFixed(2)} MB total.`);
  console.log(`model.json SHA-256 ${createHash("sha256").update(await readFile(resolve(destination, "model.json"))).digest("hex")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();

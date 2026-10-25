import assert from "node:assert/strict";
import { assessPublicationSafety } from "../tools/check-publication-safety.mjs";

const requiredIgnore = [".env", ".env.*", "!.env.example", "data/*.ndjson", "data/job-brief-images/", "node_modules/", "*.log", "backups/"].join("\n");

async function assess(files, { clean = true, gitignore = requiredIgnore, sizes = {} } = {}) {
  return assessPublicationSafety({
    trackedFiles: Object.keys(files),
    clean,
    gitignore,
    readTrackedFile: async (file) => Buffer.from(files[file]),
    statTrackedFile: async (file) => ({ size: sizes[file] ?? Buffer.byteLength(files[file]) })
  });
}

const safe = await assess({ "server.mjs": "export const ready = true;", ".env.example": "APP_SECRET=<set-in-provider>", "data/.gitkeep": "" });
assert.equal(safe.ok, true, safe.errors.join("\n"));
assert.equal(safe.fileCount, 3);

for (const forbidden of [".env", ".env.production", "data/customer.ndjson", "backups/source.zip", "server.log", "certificate.pem"]) {
  const report = await assess({ "server.mjs": "safe", [forbidden]: "private" });
  assert.equal(report.ok, false, `${forbidden} was accepted for publication.`);
  assert(report.errors.some((error) => error.includes(forbidden)));
}

const stripeLive = ["sk", "live", "1234567890abcdefghijklmnop"].join("_");
const secret = await assess({ "src/config.mjs": `export const key = "${stripeLive}";` });
assert.equal(secret.ok, false, "A live provider secret was accepted.");
assert(secret.errors.some((error) => error.includes("Stripe live secret")));

// Key material is caught; the marker alone is not. Assembled at runtime so this
// file never carries a header followed by a body itself.
const pemHeader = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
const pemFooter = ["-----END", "PRIVATE KEY-----"].join(" ");
const keyBody = Buffer.from(Array.from({ length: 96 }, (_, index) => (index * 37) % 256)).toString("base64");
for (const [label, source] of [
  ["a PEM block", `${pemHeader}\n${keyBody.match(/.{1,64}/g).join("\n")}\n${pemFooter}\n`],
  ["an escaped-newline env value", `APPLE_PRIVATE_KEY="${pemHeader}\\n${keyBody}\\n${pemFooter}"`],
  ["an RSA key", `${pemHeader.replace("PRIVATE", "RSA PRIVATE")}\n${keyBody}\n${pemFooter.replace("PRIVATE", "RSA PRIVATE")}`]
]) {
  const report = await assess({ "src/key.mjs": source });
  assert.equal(report.ok, false, `${label} was accepted for publication.`);
  assert(report.errors.some((error) => error.includes("private cryptographic key")), `${label} was not reported as key material.`);
}
for (const [label, source] of [
  ["a validator checking a supplied key's shape", `if (!key.includes("${pemHeader}")) errors.push("invalid");`],
  ["prose naming the header", `The guard matches \`${pemHeader}\` in documentation.`],
  ["a placeholder fixture", `const key = "${pemHeader}\\nunit-test-private-key-not-used\\n${pemFooter}";`]
]) {
  const report = await assess({ "src/key.mjs": source });
  assert.equal(report.ok, true, `${label} was blocked as a key: ${report.errors.join("; ")}`);
}

// The synthetic scan benchmark is allowed by name; anything new beside it is not.
const benchmark = await assess({ "data/scan-benchmark/README.md": "synthetic", "data/scan-benchmark/synthetic-seed.json": "{}", "data/scan-benchmark/PHOTO-EVALUATION.md": "synthetic" });
assert.equal(benchmark.ok, true, benchmark.errors.join("\n"));
const unexpected = await assess({ "data/scan-benchmark/real-customer-scan.json": "{}" });
assert.equal(unexpected.ok, false, "A new file under data/scan-benchmark/ was published without review.");

const dirty = await assess({ "server.mjs": "safe" }, { clean: false });
assert.equal(dirty.ok, false);
assert(dirty.errors.some((error) => error.includes("not clean")));

const missingIgnore = await assess({ "server.mjs": "safe" }, { gitignore: ".env" });
assert.equal(missingIgnore.ok, false);
assert(missingIgnore.errors.some((error) => error.includes("data/*.ndjson")));

const oversized = await assess({ "public/video.mp4": "small fixture" }, { sizes: { "public/video.mp4": 26 * 1024 * 1024 } });
assert.equal(oversized.ok, false);
assert(oversized.errors.some((error) => error.includes("per-file publication limit")));

console.log("Publication safety tests passed: clean-history requirement, ignore coverage, secret detection (key material, not the marker), private-path denial with the named synthetic benchmark, and size bounds.");

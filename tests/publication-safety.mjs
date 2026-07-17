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

const dirty = await assess({ "server.mjs": "safe" }, { clean: false });
assert.equal(dirty.ok, false);
assert(dirty.errors.some((error) => error.includes("not clean")));

const missingIgnore = await assess({ "server.mjs": "safe" }, { gitignore: ".env" });
assert.equal(missingIgnore.ok, false);
assert(missingIgnore.errors.some((error) => error.includes("data/*.ndjson")));

const oversized = await assess({ "public/video.mp4": "small fixture" }, { sizes: { "public/video.mp4": 26 * 1024 * 1024 } });
assert.equal(oversized.ok, false);
assert(oversized.errors.some((error) => error.includes("per-file publication limit")));

console.log("Publication safety tests passed: clean-history requirement, ignore coverage, secret detection, private-path denial and size bounds.");

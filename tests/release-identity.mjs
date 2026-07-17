import assert from "node:assert/strict";
import { loadReleaseIdentity, normalizeExpectedReleaseCommit, normalizePackagedReleaseIdentity, packagedReleaseIdentityMatches, releaseIdentityFilename } from "../release-identity.mjs";

const valid = { schemaVersion: 1, application: "Homle", sourceCommit: "A92999ED", builtAt: "2026-07-17T03:00:00.000Z", migrationCount: 40 };
assert.deepEqual(normalizePackagedReleaseIdentity(valid), { source: "packaged", sourceCommit: "a92999ed", builtAt: valid.builtAt, migrationCount: 40 });
assert.equal(normalizeExpectedReleaseCommit("A92999ED"), "a92999ed");
assert.throws(() => normalizeExpectedReleaseCommit("main"), /eight-character source commit/i);
assert.equal(packagedReleaseIdentityMatches(normalizePackagedReleaseIdentity(valid), "a92999ed", { now: Date.parse("2026-07-17T03:01:00.000Z") }), true);
assert.equal(packagedReleaseIdentityMatches(normalizePackagedReleaseIdentity(valid), "00000000", { now: Date.parse("2026-07-17T03:01:00.000Z") }), false);

for (const invalid of [
  { ...valid, schemaVersion: 2 },
  { ...valid, application: "Other" },
  { ...valid, sourceCommit: "../../secret" },
  { ...valid, builtAt: "yesterday" },
  { ...valid, migrationCount: 0 },
  { ...valid, migrationCount: 40.5 }
]) assert.throws(() => normalizePackagedReleaseIdentity(invalid), /release identity|build evidence/i);

let requestedPath = "";
const loaded = await loadReleaseIdentity({
  projectRoot: "C:\\safe-app",
  async readFileImplementation(file, encoding) {
    requestedPath = file;
    assert.equal(encoding, "utf8");
    return JSON.stringify(valid);
  }
});
assert.equal(requestedPath.endsWith(releaseIdentityFilename), true);
assert.equal(loaded.sourceCommit, "a92999ed");

const missing = await loadReleaseIdentity({
  projectRoot: "C:\\safe-app",
  async readFileImplementation() { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }
});
assert.deepEqual(missing, { source: "unidentified", sourceCommit: null, builtAt: null, migrationCount: null });

await assert.rejects(loadReleaseIdentity({ projectRoot: "C:\\safe-app", async readFileImplementation() { return "{"; } }), /valid JSON/i);
await assert.rejects(loadReleaseIdentity({ projectRoot: "C:\\safe-app", async readFileImplementation() { return "x".repeat(4097); } }), /size limit/i);
await assert.rejects(loadReleaseIdentity({ projectRoot: "C:\\safe-app", async readFileImplementation() { throw new Error("access denied"); } }), /access denied/i);

console.log("Release identity tests passed: exact packaged source evidence, bounded parsing, safe missing-file fallback and fail-closed malformed/tampered files.");

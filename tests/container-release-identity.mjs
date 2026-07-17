import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateContainerReleaseIdentity, lockedMigrationCount, renderSourceCommit } from "../tools/generate-container-release-identity.mjs";
import { loadReleaseIdentity, packagedReleaseIdentityMatches } from "../release-identity.mjs";

const fullCommit = "abcdef0123456789abcdef0123456789abcdef01";
assert.equal(renderSourceCommit(fullCommit.toUpperCase()), "abcdef01");
for (const invalid of ["", "abcdef0", "abcdef01", `${fullCommit}0`, "g".repeat(40)]) {
  assert.throws(() => renderSourceCommit(invalid), /exact 40-character source commit/);
}

const validLock = { version: 1, migrations: [
  { order: 1, file: "001_marketplace_schema.sql", sha256: "a".repeat(64) },
  { order: 2, file: "002_marketplace_security.sql", sha256: "b".repeat(64) }
] };
assert.equal(lockedMigrationCount(validLock), 2);
for (const invalid of [
  null,
  { version: 2, migrations: validLock.migrations },
  { version: 1, migrations: [] },
  { version: 1, migrations: [{ ...validLock.migrations[0], order: 2 }] },
  { version: 1, migrations: [validLock.migrations[0], { ...validLock.migrations[0], order: 2 }] },
  { version: 1, migrations: [{ ...validLock.migrations[0], sha256: "not-a-hash" }] }
]) assert.throws(() => lockedMigrationCount(invalid), /Migration lock/);

const root = await mkdtemp(path.join(tmpdir(), "homle-container-release-"));
try {
  const outputPath = path.join(root, "homle-release.json");
  const builtAt = "2026-07-17T06:30:00.000Z";
  const writes = [];
  const generated = await generateContainerReleaseIdentity({
    env: { RENDER_GIT_COMMIT: fullCommit },
    root,
    outputPath,
    builtAt,
    async readFileImplementation(selectedPath) {
      assert.equal(selectedPath, path.join(root, "db", "migration-lock.json"));
      return JSON.stringify(validLock);
    },
    async writeFileImplementation(selectedPath, content, options) {
      writes.push({ selectedPath, content, options });
      await import("node:fs/promises").then(({ writeFile }) => writeFile(selectedPath, content, options));
    }
  });
  assert.equal(generated.sourceCommit, "abcdef01");
  assert.equal(generated.migrationCount, 2);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].options.flag, "wx");
  assert.equal(writes[0].options.mode, 0o600);
  const loaded = await loadReleaseIdentity({ projectRoot: root });
  assert.equal(packagedReleaseIdentityMatches(loaded, "abcdef01", { now: Date.parse(builtAt) }), true);
  const raw = JSON.parse(await readFile(outputPath, "utf8"));
  assert.deepEqual(raw, { schemaVersion: 1, application: "Homle", sourceCommit: "abcdef01", builtAt, migrationCount: 2 });
  await assert.rejects(() => generateContainerReleaseIdentity({ env: { RENDER_GIT_COMMIT: fullCommit }, root, outputPath, builtAt, readFileImplementation: async () => JSON.stringify(validLock) }), /EEXIST/);
} finally {
  await rm(root, { recursive: true, force: true });
}

await assert.rejects(() => generateContainerReleaseIdentity({ env: {}, readFileImplementation: async () => JSON.stringify(validLock), writeFileImplementation: async () => {} }), /RENDER_GIT_COMMIT/);
await assert.rejects(() => generateContainerReleaseIdentity({ env: { RENDER_GIT_COMMIT: fullCommit }, readFileImplementation: async () => "{" , writeFileImplementation: async () => {} }), /not valid JSON/);

console.log("Container release identity tests passed: exact Render commit, locked migration evidence, validated package identity and no-overwrite output.");

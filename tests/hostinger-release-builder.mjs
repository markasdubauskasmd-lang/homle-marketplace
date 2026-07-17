import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildHostingerRelease,
  inspectZipEntries,
  selectReleaseFiles,
  validateReleaseEntries
} from "../tools/build-hostinger-release.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedFiles = await selectReleaseFiles(root);

for (const required of [
  "server.mjs",
  "travel-coverage.mjs",
  "authentication-activation-readiness.mjs",
  "public/index.html",
  "src/marketplace/runtime.mjs",
  "db/migration-lock.json",
  "db/migrations/038_facebook_data_deletion_callback.sql",
  "db/runtime-role-grants.sql",
  "db/worker-role-grants.sql",
  "db/bootstrap/assert-empty-staging.sql",
  "db/integration/deployment-verification.sql",
  "scripts/marketplace-worker.mjs",
  "tools/check-dependency-lock.mjs",
  "tools/domain-readiness.mjs",
  "tools/production-preflight.mjs",
  "tools/authentication-preflight.mjs",
  "tools/bootstrap-staging-database.mjs",
  "tools/staging-service-probe.mjs",
  "tools/build-hostinger-release.mjs"
]) {
  assert(expectedFiles.includes(required), `Release selection omitted ${required}.`);
}
for (const forbidden of [
  ".env",
  "data/cleaning-requests.ndjson",
  "tests/hostinger-release-builder.mjs",
  "docs/HOSTINGER_DEPLOYMENT.md",
  "public/tracking-test.html",
  "public/tracking-test.js"
]) {
  assert(!expectedFiles.includes(forbidden), `Release selection included private or non-runtime file ${forbidden}.`);
}

assert.throws(() => inspectZipEntries(Buffer.from("not a zip")), /valid ZIP/i, "Corrupt archives were accepted.");
assert.throws(
  () => validateReleaseEntries([{ name: "../secret", directory: false }], ["../secret"]),
  /unsafe path/i,
  "Archive traversal paths were accepted."
);
assert.throws(
  () => validateReleaseEntries([{ name: ".env.production", directory: false }], [".env.production"]),
  /environment-secret/i,
  "Environment-secret files were accepted."
);

const outputDirectory = await mkdtemp(path.join(tmpdir(), "homle-release-test-"));
try {
  const release = await buildHostingerRelease({ root, outputDirectory, requireClean: false });
  assert.match(release.sourceCommit, /^[0-9a-f]{8}$/);
  assert.match(release.sha256, /^[0-9A-F]{64}$/);
  assert.equal(release.privateMaterialIncluded, false);
  assert.equal(release.requiredRuntimeFilesVerified, true);
  assert.equal(release.databaseAssetsVerified, true);
  assert.equal(release.migrationCount, 38);
  assert(release.entryCount >= release.fileCount && release.fileCount === expectedFiles.length);

  const archive = await readFile(release.archivePath);
  const entries = inspectZipEntries(archive);
  assert.equal(entries.some((entry) => entry.name === "travel-coverage.mjs"), true, "Built release omitted the server's travel coverage dependency.");
  assert.equal(entries.some((entry) => entry.name === "db/migrations/038_facebook_data_deletion_callback.sql"), true, "Built release omitted the locked Facebook data-deletion migration.");
  assert.equal(entries.some((entry) => entry.name === "public/tracking-test.html"), false, "Built release exposed the local tracking lab.");
  validateReleaseEntries(entries, expectedFiles);

  const manifest = JSON.parse(await readFile(release.manifestPath, "utf8"));
  assert.equal(manifest.archive, path.basename(release.archivePath));
  assert.equal(manifest.sha256, release.sha256);
  assert.equal(manifest.fileCount, expectedFiles.length);
  await assert.rejects(
    buildHostingerRelease({ root, outputDirectory, requireClean: false }),
    /already exists/i,
    "A release was overwritten without explicit permission."
  );
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}

console.log("Hostinger release builder tests passed: dependency-complete allowlist, ZIP integrity, private-material exclusion, manifest evidence and overwrite protection.");

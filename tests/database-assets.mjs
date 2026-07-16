import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDatabaseAssets } from "../db/migration-assets.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDatabaseDirectory = path.join(projectRoot, "db");
const tempBase = path.resolve(os.tmpdir());
const fixtureRoot = path.join(tempBase, `tideway-database-assets-test-${randomUUID()}`);
const fixtureDatabaseDirectory = path.join(fixtureRoot, "db");

function assertSafeFixturePath(candidate) {
  const resolved = path.resolve(candidate);
  assert.ok(resolved.startsWith(`${tempBase}${path.sep}`), "fixture must remain inside the system temp directory");
  assert.ok(path.basename(resolved).startsWith("tideway-database-assets-test-"), "fixture must use the expected disposable prefix");
}

async function freshFixture() {
  const resolvedDatabaseFixture = path.resolve(fixtureDatabaseDirectory);
  assert.ok(resolvedDatabaseFixture.startsWith(`${path.resolve(fixtureRoot)}${path.sep}`), "database fixture must remain inside its disposable root");
  await rm(fixtureDatabaseDirectory, { recursive: true, force: true });
  await cp(sourceDatabaseDirectory, fixtureDatabaseDirectory, { recursive: true });
}

try {
  const repositoryResult = await verifyDatabaseAssets();
  assert.equal(repositoryResult.ok, true, repositoryResult.errors.join("\n"));
  assert.equal(repositoryResult.postgresqlMajor, 16);
  assert.equal(repositoryResult.migrations.length, 31);
  assert.deepEqual(repositoryResult.grantFiles.sort(), ["runtime-role-grants.sql", "worker-role-grants.sql"]);

  await freshFixture();
  const tamperedPath = path.join(fixtureDatabaseDirectory, "migrations", "004_social_identity_and_onboarding.sql");
  await writeFile(tamperedPath, `${await readFile(tamperedPath, "utf8")}\nSELECT 1;\n`);
  const tampered = await verifyDatabaseAssets({ databaseDirectory: fixtureDatabaseDirectory });
  assert.equal(tampered.ok, false);
  assert.ok(tampered.errors.some((error) => error.includes("004_social_identity_and_onboarding.sql does not match its locked SHA-256")));
  assert.ok(tampered.errors.some((error) => error.includes("must end with COMMIT")), "transaction-boundary tampering must also be visible");

  await freshFixture();
  await unlink(path.join(fixtureDatabaseDirectory, "migrations", "019_expired_session_purge.sql"));
  const missing = await verifyDatabaseAssets({ databaseDirectory: fixtureDatabaseDirectory });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((error) => error.includes("Missing locked migrations: 019_expired_session_purge.sql")));

  await freshFixture();
  await writeFile(path.join(fixtureDatabaseDirectory, "migrations", "020_unapproved.sql"), "BEGIN;\nCOMMIT;\n");
  const unexpected = await verifyDatabaseAssets({ databaseDirectory: fixtureDatabaseDirectory });
  assert.equal(unexpected.ok, false);
  assert.ok(unexpected.errors.some((error) => error.includes("Unexpected unlocked migrations: 020_unapproved.sql")));

  await freshFixture();
  const lockPath = path.join(fixtureDatabaseDirectory, "migration-lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  lock.migrations[5].order = 7;
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  const nonConsecutive = await verifyDatabaseAssets({ databaseDirectory: fixtureDatabaseDirectory });
  assert.equal(nonConsecutive.ok, false);
  assert.ok(nonConsecutive.errors.some((error) => error.includes("Migration position 6 must have order 6")));

  console.log("Database asset tests passed: locked order, checksums, transaction boundaries, missing/unexpected migration detection and role grants.");
} finally {
  assertSafeFixturePath(fixtureRoot);
  await rm(fixtureRoot, { recursive: true, force: true });
}

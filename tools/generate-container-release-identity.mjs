#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePackagedReleaseIdentity, releaseIdentityFilename } from "../release-identity.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fullCommitPattern = /^[0-9a-f]{40}$/;
const migrationFilenamePattern = /^\d{3}_[a-z0-9_]+\.sql$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

export function renderSourceCommit(value) {
  const supplied = String(value || "").trim().toLowerCase();
  if (!fullCommitPattern.test(supplied)) throw new TypeError("RENDER_GIT_COMMIT must be the exact 40-character source commit supplied by Render.");
  return supplied.slice(0, 8);
}

export function lockedMigrationCount(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 || !Array.isArray(value.migrations)) {
    throw new TypeError("Migration lock has an unsupported structure.");
  }
  if (value.migrations.length < 1 || value.migrations.length > 10_000) throw new TypeError("Migration lock has an invalid migration count.");
  const filenames = new Set();
  value.migrations.forEach((migration, index) => {
    const valid = migration && typeof migration === "object" && !Array.isArray(migration)
      && migration.order === index + 1
      && migrationFilenamePattern.test(String(migration.file || ""))
      && sha256Pattern.test(String(migration.sha256 || ""));
    if (!valid || filenames.has(migration.file)) throw new TypeError("Migration lock contains invalid or duplicate migration evidence.");
    filenames.add(migration.file);
  });
  return value.migrations.length;
}

export async function generateContainerReleaseIdentity({
  env = process.env,
  root = projectRoot,
  outputPath = path.join(root, releaseIdentityFilename),
  builtAt = new Date().toISOString(),
  readFileImplementation = readFile,
  writeFileImplementation = writeFile
} = {}) {
  const lockPath = path.join(path.resolve(root), "db", "migration-lock.json");
  const lockText = await readFileImplementation(lockPath, "utf8");
  if (Buffer.byteLength(lockText, "utf8") > 1024 * 1024) throw new TypeError("Migration lock exceeds the build-time size limit.");
  let lock;
  try { lock = JSON.parse(lockText); } catch { throw new TypeError("Migration lock is not valid JSON."); }
  const identity = normalizePackagedReleaseIdentity({
    schemaVersion: 1,
    application: "Homle",
    sourceCommit: renderSourceCommit(env.RENDER_GIT_COMMIT),
    builtAt,
    migrationCount: lockedMigrationCount(lock)
  });
  const destination = path.resolve(outputPath);
  await writeFileImplementation(destination, `${JSON.stringify({ schemaVersion: 1, application: "Homle", sourceCommit: identity.sourceCommit, builtAt: identity.builtAt, migrationCount: identity.migrationCount }, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return Object.freeze({ ...identity, outputPath: destination });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = await generateContainerReleaseIdentity();
    console.log(JSON.stringify({ ok: true, sourceCommit: result.sourceCommit, migrationCount: result.migrationCount }));
  } catch (error) {
    console.error(`Homle container release identity failed: ${error.message}`);
    process.exitCode = 1;
  }
}

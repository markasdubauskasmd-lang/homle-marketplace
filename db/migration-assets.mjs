import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultDatabaseDirectory = path.dirname(fileURLToPath(import.meta.url));
const checksumPattern = /^[a-f0-9]{64}$/;
const migrationNamePattern = /^(\d{3})_[a-z0-9_]+\.sql$/;
const requiredGrantFiles = Object.freeze(["runtime-role-grants.sql", "worker-role-grants.sql"]);

function checksum(content) {
  return createHash("sha256").update(content).digest("hex");
}

function transactionErrors(file, content) {
  const executableLines = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("--"));
  const errors = [];
  if (executableLines[0] !== "BEGIN;") errors.push(`${file} must start with BEGIN; after optional comments.`);
  if (executableLines.at(-1) !== "COMMIT;") errors.push(`${file} must end with COMMIT;.`);
  return errors;
}

export async function verifyDatabaseAssets({ databaseDirectory = defaultDatabaseDirectory } = {}) {
  const resolvedDatabaseDirectory = path.resolve(databaseDirectory);
  const migrationsDirectory = path.join(resolvedDatabaseDirectory, "migrations");
  const lockPath = path.join(resolvedDatabaseDirectory, "migration-lock.json");
  const errors = [];
  let lock;

  try {
    lock = JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    return { ok: false, errors: ["db/migration-lock.json is missing or invalid JSON."], postgresqlMajor: null, migrations: [], grantFiles: [] };
  }

  if (lock.version !== 1) errors.push("The database migration lock version must be 1.");
  if (!Number.isInteger(lock.postgresqlMajor) || lock.postgresqlMajor < 16) errors.push("The database migration lock must require PostgreSQL 16 or newer.");
  if (!Array.isArray(lock.migrations) || lock.migrations.length === 0) errors.push("The database migration lock must contain at least one migration.");
  if (!Array.isArray(lock.grantFiles)) errors.push("The database migration lock must contain its role-grant files.");

  const lockedMigrations = Array.isArray(lock.migrations) ? lock.migrations : [];
  const lockedGrantFiles = Array.isArray(lock.grantFiles) ? lock.grantFiles : [];
  const lockedMigrationNames = [];

  for (let index = 0; index < lockedMigrations.length; index += 1) {
    const item = lockedMigrations[index] || {};
    const expectedOrder = index + 1;
    const match = typeof item.file === "string" ? item.file.match(migrationNamePattern) : null;
    if (item.order !== expectedOrder) errors.push(`Migration position ${expectedOrder} must have order ${expectedOrder}.`);
    if (!match || Number(match[1]) !== expectedOrder) errors.push(`Migration position ${expectedOrder} has an invalid or non-consecutive filename.`);
    if (!checksumPattern.test(item.sha256 || "")) errors.push(`Migration position ${expectedOrder} has an invalid SHA-256 lock.`);
    if (typeof item.file === "string") lockedMigrationNames.push(item.file);
  }

  if (new Set(lockedMigrationNames).size !== lockedMigrationNames.length) errors.push("The migration lock contains duplicate filenames.");

  let actualMigrationNames = [];
  try {
    actualMigrationNames = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
  } catch {
    errors.push("The db/migrations directory could not be read.");
  }

  const missingMigrations = lockedMigrationNames.filter((file) => !actualMigrationNames.includes(file));
  const unexpectedMigrations = actualMigrationNames.filter((file) => !lockedMigrationNames.includes(file));
  if (missingMigrations.length) errors.push(`Missing locked migrations: ${missingMigrations.join(", ")}.`);
  if (unexpectedMigrations.length) errors.push(`Unexpected unlocked migrations: ${unexpectedMigrations.join(", ")}.`);

  for (const item of lockedMigrations) {
    if (!item || typeof item.file !== "string" || !actualMigrationNames.includes(item.file)) continue;
    const content = await readFile(path.join(migrationsDirectory, item.file));
    if (checksum(content) !== item.sha256) errors.push(`${item.file} does not match its locked SHA-256.`);
    errors.push(...transactionErrors(item.file, content.toString("utf8")));
  }

  const grantNames = lockedGrantFiles.map((item) => item?.file).filter((file) => typeof file === "string");
  if (grantNames.length !== requiredGrantFiles.length || requiredGrantFiles.some((file) => !grantNames.includes(file)) || grantNames.some((file) => !requiredGrantFiles.includes(file))) {
    errors.push(`Role-grant lock must contain exactly: ${requiredGrantFiles.join(", ")}.`);
  }
  if (new Set(grantNames).size !== grantNames.length) errors.push("The role-grant lock contains duplicate filenames.");

  for (const item of lockedGrantFiles) {
    if (!item || typeof item.file !== "string") continue;
    if (!requiredGrantFiles.includes(item.file)) continue;
    if (!checksumPattern.test(item.sha256 || "")) {
      errors.push(`${item.file} has an invalid SHA-256 lock.`);
      continue;
    }
    try {
      const content = await readFile(path.join(resolvedDatabaseDirectory, item.file));
      if (checksum(content) !== item.sha256) errors.push(`${item.file} does not match its locked SHA-256.`);
      errors.push(...transactionErrors(item.file, content.toString("utf8")));
    } catch {
      errors.push(`${item.file} is missing or unreadable.`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    postgresqlMajor: lock.postgresqlMajor,
    migrations: lockedMigrationNames,
    grantFiles: grantNames
  };
}

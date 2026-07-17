#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDatabaseAssets } from "../db/migration-assets.mjs";
import { postgresVerificationEnvironment, sanitizePostgresOutput } from "./postgres-verification-runner.mjs";

const toolPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(toolPath), "..");
const databaseDirectory = path.join(projectRoot, "db");
const guardPath = path.join(databaseDirectory, "bootstrap", "assert-empty-staging.sql");
const verifierPath = path.join(databaseDirectory, "integration", "deployment-verification.sql");
export const stagingBootstrapConfirmation = "BOOTSTRAP EMPTY HOMLE STAGING DATABASE";

function stagingTarget(summary, confirmation) {
  if (confirmation !== stagingBootstrapConfirmation) throw new Error(`Set HOMLE_DATABASE_BOOTSTRAP_CONFIRMATION exactly to: ${stagingBootstrapConfirmation}`);
  if (!/_(?:tideway|homle)_staging$/i.test(summary.database)) throw new Error("Fresh marketplace bootstrap database name must end in _tideway_staging or _homle_staging.");
  if (["tideway_app", "tideway_worker"].includes(summary.user)) throw new Error("Fresh marketplace bootstrap must authenticate as a separate migration owner.");
}

function argumentsFor(file) {
  return ["-X", "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--file", file];
}

function runStep({ label, file, command, execute, environment, mutating }) {
  const result = execute(command, argumentsFor(file), { encoding: "utf8", windowsHide: true, env: environment });
  if (result?.error?.code === "ENOENT") throw new Error("Fresh marketplace bootstrap requires the psql client, which is not installed or not on PATH.");
  if (result?.error) throw new Error(`${label} could not start the psql client.`);
  if (result?.status !== 0) {
    const error = new Error(mutating
      ? `${label} failed after staging initialization began. Do not retry against this partial database; delete and recreate the empty staging database first.`
      : `${label} failed before staging initialization.`);
    error.bootstrapOutput = sanitizePostgresOutput(`${result?.stdout || ""}\n${result?.stderr || ""}`);
    throw error;
  }
  return sanitizePostgresOutput(result.stdout);
}

export async function bootstrapFreshStagingDatabase(options = {}) {
  const connectionUrl = options.connectionUrl ?? process.env.DATABASE_BOOTSTRAP_URL;
  const prepared = postgresVerificationEnvironment(connectionUrl, options.baseEnvironment || process.env);
  stagingTarget(prepared.summary, options.confirmation ?? process.env.HOMLE_DATABASE_BOOTSTRAP_CONFIRMATION);
  const verifyAssets = options.verifyAssets || verifyDatabaseAssets;
  const assets = await verifyAssets({ databaseDirectory: options.databaseDirectory || databaseDirectory });
  if (!assets?.ok) throw new Error(`Fresh marketplace bootstrap refused invalid database assets: ${(assets?.errors || ["unknown asset failure"]).join(" ")}`);
  if (!Array.isArray(assets.migrations) || assets.migrations.length < 1) throw new Error("Fresh marketplace bootstrap found no locked migrations.");

  const command = options.psqlCommand || "psql";
  const execute = options.spawn || spawnSync;
  const root = path.resolve(options.databaseDirectory || databaseDirectory);
  const environment = { ...prepared.environment, PGAPPNAME: "homle-fresh-staging-bootstrap" };
  runStep({ label: "Fresh staging target guard", file: options.guardPath || guardPath, command, execute, environment, mutating: false });

  for (const migration of assets.migrations) {
    runStep({
      label: `Locked migration ${migration}`,
      file: path.join(root, "migrations", migration),
      command,
      execute,
      environment,
      mutating: true
    });
  }
  for (const grantFile of assets.grantFiles) {
    runStep({ label: `Restricted-role grants ${grantFile}`, file: path.join(root, grantFile), command, execute, environment, mutating: true });
  }
  const verificationOutput = runStep({ label: "Post-bootstrap deployment verification", file: options.verifierPath || verifierPath, command, execute, environment, mutating: true });
  if (!verificationOutput.includes('"verified" : true') && !verificationOutput.includes('"verified":true')) throw new Error("Post-bootstrap deployment verification returned no verified result. Do not enable the marketplace.");

  return Object.freeze({
    database: prepared.summary.database,
    host: prepared.summary.host,
    port: prepared.summary.port,
    sslMode: prepared.summary.sslMode,
    migrationCount: assets.migrations.length,
    grantsApplied: assets.grantFiles.length,
    verified: true
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === toolPath) {
  try {
    const result = await bootstrapFreshStagingDatabase();
    console.log(`Fresh Homle staging database ${result.database} on ${result.host}:${result.port} passed ${result.migrationCount} locked migrations, ${result.grantsApplied} grant files and deployment verification using ${result.sslMode}.`);
  } catch (error) {
    console.error(error.message);
    if (error.bootstrapOutput) console.error(error.bootstrapOutput.trim());
    process.exitCode = 1;
  }
}

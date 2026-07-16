#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateProductionDeployment } from "../deployment-readiness.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = validateProductionDeployment(process.env, { projectRoot });
if (!result.ok) {
  console.error("Tideway production preflight failed:");
  for (const error of result.errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, mode: result.mode, marketplaceEnabled: result.marketplaceEnabled, paymentsEnabled: result.paymentsEnabled, checks: result.checks }, null, 2));
}

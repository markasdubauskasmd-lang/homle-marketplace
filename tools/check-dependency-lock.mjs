import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const expectedDriverVersion = "8.22.0";
const expectedLockSha256 = "9856015f0d9df2fd5adc7d8354c168db05c0e41885af8196bf17f9257a72b257";
const expectedDriverIntegrity = "sha512-8wih1vVIBMxoUM2oB4soJsD9tDnDpLv4OXBJ+EJzFsvycD+lfyIreC2gGHq78f8jbLLt+bvlPTFdFZfJkOuzAA==";

function sha256(value) {
  if (/\r(?!\n)/.test(value)) throw new TypeError("The dependency lockfile contains unsupported line endings.");
  return createHash("sha256").update(value.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

function parsedPackage(value) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new TypeError("package.json is not valid JSON.");
  }
}

export function validateDependencyAssets(packageJsonText, lockText) {
  const manifest = parsedPackage(packageJsonText);
  const dependencyNames = Object.keys(manifest.dependencies || {}).sort();
  if (manifest.private !== true) throw new TypeError("The application package must remain private.");
  if (manifest.packageManager !== "pnpm@11.7.0") throw new TypeError("The reviewed pnpm 11.7.0 package manager must remain pinned.");
  if (manifest.engines?.node !== ">=20") throw new TypeError("The reviewed dependency boundary requires Node.js 20 or newer.");
  if (dependencyNames.join(",") !== "pg") throw new TypeError("Only the reviewed PostgreSQL runtime dependency is allowed in the production manifest.");
  if (manifest.dependencies.pg !== expectedDriverVersion) throw new TypeError(`pg must be pinned exactly to ${expectedDriverVersion}.`);
  if (typeof lockText !== "string" || !lockText) throw new TypeError("pnpm-lock.yaml is required.");
  if (!lockText.startsWith("lockfileVersion: '9.0'\n") && !lockText.startsWith("lockfileVersion: '9.0'\r\n")) throw new TypeError("The reviewed pnpm lockfile format is required.");
  if (!lockText.includes(`specifier: ${expectedDriverVersion}`) || !lockText.includes(`version: ${expectedDriverVersion}`) || !lockText.includes(`pg@${expectedDriverVersion}:`) || !lockText.includes(`resolution: {integrity: ${expectedDriverIntegrity}}`)) throw new TypeError("The lockfile does not contain the reviewed pg package and integrity evidence.");
  const actualHash = sha256(lockText);
  if (actualHash !== expectedLockSha256) throw new TypeError(`The dependency lockfile differs from the reviewed graph (SHA-256 ${actualHash}).`);
  return Object.freeze({ driver: "pg", version: expectedDriverVersion, lockSha256: actualHash });
}

export async function checkDependencyAssets(baseDirectory = new URL("../", import.meta.url)) {
  const [packageJsonText, lockText] = await Promise.all([
    readFile(new URL("package.json", baseDirectory), "utf8"),
    readFile(new URL("pnpm-lock.yaml", baseDirectory), "utf8")
  ]);
  return validateDependencyAssets(packageJsonText, lockText);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const result = await checkDependencyAssets();
  console.log(`Dependency assets verified: ${result.driver} ${result.version}, lock SHA-256 ${result.lockSha256}.`);
}

export const dependencyLockEvidence = Object.freeze({ expectedDriverVersion, expectedLockSha256, expectedDriverIntegrity });

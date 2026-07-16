import { readFile } from "node:fs/promises";
import { dependencyLockEvidence, validateDependencyAssets } from "../tools/check-dependency-lock.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function rejects(operation, expected) {
  try { operation(); } catch (error) { return String(error.message).includes(expected); }
  return false;
}

const packageText = await readFile(new URL("../package.json", import.meta.url), "utf8");
const lockText = await readFile(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
const verified = validateDependencyAssets(packageText, lockText);
assert(verified.driver === "pg" && verified.version === "8.22.0" && verified.lockSha256 === dependencyLockEvidence.expectedLockSha256, "The reviewed production dependency graph did not validate.");

const manifest = JSON.parse(packageText);
assert(rejects(() => validateDependencyAssets(JSON.stringify({ ...manifest, dependencies: { pg: "^8.22.0" } }), lockText), "pinned exactly"), "A mutable pg version range passed the dependency gate.");
assert(rejects(() => validateDependencyAssets(JSON.stringify({ ...manifest, dependencies: { ...manifest.dependencies, unreviewed: "1.0.0" } }), lockText), "Only the reviewed"), "An unreviewed direct production dependency passed the gate.");
assert(rejects(() => validateDependencyAssets(JSON.stringify({ ...manifest, private: false }), lockText), "remain private"), "A publishable application manifest passed the dependency gate.");
assert(rejects(() => validateDependencyAssets(JSON.stringify({ ...manifest, packageManager: "pnpm@latest" }), lockText), "must remain pinned"), "A mutable package-manager version passed the dependency gate.");
assert(rejects(() => validateDependencyAssets(packageText, lockText.replace(dependencyLockEvidence.expectedDriverIntegrity, `${dependencyLockEvidence.expectedDriverIntegrity.slice(0, -2)}xx`)), "lockfile"), "A modified dependency integrity graph passed the dependency gate.");
assert(rejects(() => validateDependencyAssets(packageText, ""), "required"), "A missing lockfile passed the dependency gate.");

console.log("Dependency lock tests passed: exact pg version, private Node 20 manifest, reviewed transitive integrity graph and missing/mutable/unreviewed dependency rejection.");

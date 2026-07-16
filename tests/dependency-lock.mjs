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
assert(verified.dependencies.pg === "8.22.0" && verified.dependencies.nodemailer === "9.0.3" && verified.dependencies.awsS3 === "3.1084.0" && verified.dependencies.sharp === "0.35.3" && verified.lockSha256 === dependencyLockEvidence.expectedLockSha256, "The reviewed production dependency graph did not validate.");

const manifest = JSON.parse(packageText);
assert(rejects(() => validateDependencyAssets(JSON.stringify({ ...manifest, dependencies: { ...manifest.dependencies, pg: "^8.22.0" } }), lockText), "pinned exactly"), "A mutable pg version range passed the dependency gate.");
assert(rejects(() => validateDependencyAssets(JSON.stringify({ ...manifest, dependencies: { ...manifest.dependencies, nodemailer: "^9.0.3" } }), lockText), "pinned exactly"), "A mutable Nodemailer version range passed the dependency gate.");
assert(rejects(() => validateDependencyAssets(JSON.stringify({ ...manifest, dependencies: { ...manifest.dependencies, "@aws-sdk/client-s3": "^3.1084.0" } }), lockText), "pinned exactly"), "A mutable AWS S3 version range passed the dependency gate.");
assert(rejects(() => validateDependencyAssets(JSON.stringify({ ...manifest, dependencies: { ...manifest.dependencies, sharp: "^0.35.3" } }), lockText), "pinned exactly"), "A mutable Sharp version range passed the dependency gate.");
assert(rejects(() => validateDependencyAssets(JSON.stringify({ ...manifest, dependencies: { ...manifest.dependencies, unreviewed: "1.0.0" } }), lockText), "Only the reviewed"), "An unreviewed direct production dependency passed the gate.");
assert(rejects(() => validateDependencyAssets(JSON.stringify({ ...manifest, private: false }), lockText), "remain private"), "A publishable application manifest passed the dependency gate.");
assert(rejects(() => validateDependencyAssets(JSON.stringify({ ...manifest, packageManager: "pnpm@latest" }), lockText), "must remain pinned"), "A mutable package-manager version passed the dependency gate.");
assert(rejects(() => validateDependencyAssets(packageText, lockText.replace(dependencyLockEvidence.expectedDriverIntegrity, `${dependencyLockEvidence.expectedDriverIntegrity.slice(0, -2)}xx`)), "lockfile"), "A modified dependency integrity graph passed the dependency gate.");
assert(rejects(() => validateDependencyAssets(packageText, lockText.replace(dependencyLockEvidence.expectedMailerIntegrity, `${dependencyLockEvidence.expectedMailerIntegrity.slice(0, -2)}xx`)), "lockfile"), "A modified mailer integrity value passed the dependency gate.");
assert(rejects(() => validateDependencyAssets(packageText, lockText.replace(dependencyLockEvidence.expectedS3ClientIntegrity, `${dependencyLockEvidence.expectedS3ClientIntegrity.slice(0, -2)}xx`)), "lockfile"), "A modified S3 client integrity value passed the dependency gate.");
assert(rejects(() => validateDependencyAssets(packageText, lockText.replace(dependencyLockEvidence.expectedSharpIntegrity, `${dependencyLockEvidence.expectedSharpIntegrity.slice(0, -2)}xx`)), "lockfile"), "A modified image-library integrity value passed the dependency gate.");
assert(rejects(() => validateDependencyAssets(packageText, ""), "required"), "A missing lockfile passed the dependency gate.");

console.log("Dependency lock tests passed: exact pg/Nodemailer/AWS-S3/Sharp versions, private Node 20.9+ manifest, reviewed integrity graph and missing/mutable/unreviewed dependency rejection.");

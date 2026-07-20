import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const expectedDriverVersion = "8.22.0";
const expectedMailerVersion = "9.0.3";
const expectedS3Version = "3.1084.0";
const expectedSharpVersion = "0.35.3";
const expectedStripeVersion = "22.1.1";
// Added deliberately for the assisted walkthrough summary. It is an optional
// runtime capability: with no provider configured the SDK is never called and
// the on-device checklist parser remains the only path.
const expectedAnthropicVersion = "0.112.3";
// Updated when @anthropic-ai/sdk 0.112.3 was added for the assisted
// walkthrough summary. Any other change to the dependency graph must fail here
// until it has been reviewed the same way.
const expectedLockSha256 = "403040bf9ff59c07076c5079e416ea6354c2ec147bc3b0347d68bcab244fd665";
const expectedDriverIntegrity = "sha512-8wih1vVIBMxoUM2oB4soJsD9tDnDpLv4OXBJ+EJzFsvycD+lfyIreC2gGHq78f8jbLLt+bvlPTFdFZfJkOuzAA==";
const expectedMailerIntegrity = "sha512-n+YP+NKwR5zRWa60k3GiQ6Q3B4KXCoAw40dAKeCtYn020iNN74aWK2liXIC3ZEATeGql7we3tE3t8QwhY0eskw==";
const expectedS3ClientIntegrity = "sha512-W8KZlbU3vL4N0rZnXqryH5Ft3fkBnGypaorZmFxBoZRMGkwtvRBGiSnNXu1/1a/j/qZNwwt6LLNBWQQysB/pRg==";
const expectedS3PresignerIntegrity = "sha512-2IwtgX/5/G7rKxc9cp1eGdrpJrZ0sl88bKavjCWGSkMPxFmtbSnms+guAhSltZHjJbT34rfudRwW30aKtLOqbA==";
const expectedSharpIntegrity = "sha512-ej0zVHuZGHCiABXcNxeYhpRnPNPAcvbG8RMdBAhDAxLKkCRVSpK3Iyu7qbqw3JMzoj0REeM6f3tJLtVwl0023Q==";
const expectedStripeIntegrity = "sha512-cmodIYP27tBkJ8G7DuGgWw0PFuemlFZbuF3Wwr1TrjFjUa3T7NIgCe6TVwX8BO2ynu+xtTuDGfHafNDCPt9lXA==";
const expectedAnthropicIntegrity = "sha512-wjcozJlitVIuBEw9cj/xBuRznwkhcLmXmNzlFoeHbh4AvrDG3HGZrdvEOTTmobcbhjGkfOpKbmDTCQ4s9LQvCg==";

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
  if (manifest.engines?.node !== ">=20.9.0") throw new TypeError("The reviewed dependency boundary requires Node.js 20.9 or newer.");
  if (dependencyNames.join(",") !== "@anthropic-ai/sdk,@aws-sdk/client-s3,@aws-sdk/s3-request-presigner,nodemailer,pg,sharp,stripe") throw new TypeError("Only the reviewed database, SMTP, private-media, payment and walkthrough-summary runtime dependencies are allowed in the production manifest.");
  if (manifest.dependencies.pg !== expectedDriverVersion) throw new TypeError(`pg must be pinned exactly to ${expectedDriverVersion}.`);
  if (manifest.dependencies.nodemailer !== expectedMailerVersion) throw new TypeError(`nodemailer must be pinned exactly to ${expectedMailerVersion}.`);
  if (manifest.dependencies["@aws-sdk/client-s3"] !== expectedS3Version || manifest.dependencies["@aws-sdk/s3-request-presigner"] !== expectedS3Version) throw new TypeError(`AWS S3 packages must be pinned exactly to the matched ${expectedS3Version} release.`);
  if (manifest.dependencies.sharp !== expectedSharpVersion) throw new TypeError(`sharp must be pinned exactly to ${expectedSharpVersion}.`);
  if (manifest.dependencies.stripe !== expectedStripeVersion) throw new TypeError(`stripe must be pinned exactly to ${expectedStripeVersion}.`);
  if (manifest.dependencies["@anthropic-ai/sdk"] !== expectedAnthropicVersion) throw new TypeError(`@anthropic-ai/sdk must be pinned exactly to ${expectedAnthropicVersion}.`);
  if (typeof lockText !== "string" || !lockText) throw new TypeError("pnpm-lock.yaml is required.");
  if (!lockText.startsWith("lockfileVersion: '9.0'\n") && !lockText.startsWith("lockfileVersion: '9.0'\r\n")) throw new TypeError("The reviewed pnpm lockfile format is required.");
  if (!lockText.includes(`specifier: ${expectedDriverVersion}`) || !lockText.includes(`version: ${expectedDriverVersion}`) || !lockText.includes(`pg@${expectedDriverVersion}:`) || !lockText.includes(`resolution: {integrity: ${expectedDriverIntegrity}}`)) throw new TypeError("The lockfile does not contain the reviewed pg package and integrity evidence.");
  if (!lockText.includes(`nodemailer@${expectedMailerVersion}:`) || !lockText.includes(`resolution: {integrity: ${expectedMailerIntegrity}}`) || !new RegExp(`^  nodemailer@${expectedMailerVersion.replaceAll(".", "\\.")}: \\{\\}$`, "m").test(lockText)) throw new TypeError("The lockfile does not contain the reviewed zero-transitive-dependency Nodemailer package and integrity evidence.");
  if (!lockText.includes(`'@aws-sdk/client-s3@${expectedS3Version}':`) || !lockText.includes(`resolution: {integrity: ${expectedS3ClientIntegrity}}`) || !lockText.includes(`'@aws-sdk/s3-request-presigner@${expectedS3Version}':`) || !lockText.includes(`resolution: {integrity: ${expectedS3PresignerIntegrity}}`)) throw new TypeError("The lockfile does not contain the matched reviewed AWS S3 packages and integrity evidence.");
  if (!lockText.includes(`sharp@${expectedSharpVersion}:`) || !lockText.includes(`resolution: {integrity: ${expectedSharpIntegrity}}`) || !lockText.includes("engines: {node: '>=20.9.0'}")) throw new TypeError("The lockfile does not contain the reviewed Sharp package, engine and integrity evidence.");
  if (!lockText.includes(`'@anthropic-ai/sdk@${expectedAnthropicVersion}':`) || !lockText.includes(`resolution: {integrity: ${expectedAnthropicIntegrity}}`)) throw new TypeError("The lockfile does not contain the reviewed Anthropic SDK package and integrity evidence.");
  if (!lockText.includes(`stripe@${expectedStripeVersion}:`) || !lockText.includes(`resolution: {integrity: ${expectedStripeIntegrity}}`) || !new RegExp(`^  stripe@${expectedStripeVersion.replaceAll(".", "\\.")}: \\{\\}$`, "m").test(lockText)) throw new TypeError("The lockfile does not contain the reviewed zero-runtime-transitive Stripe package and integrity evidence.");
  const actualHash = sha256(lockText);
  if (actualHash !== expectedLockSha256) throw new TypeError(`The dependency lockfile differs from the reviewed graph (SHA-256 ${actualHash}).`);
  return Object.freeze({ dependencies: Object.freeze({ awsS3: expectedS3Version, nodemailer: expectedMailerVersion, pg: expectedDriverVersion, sharp: expectedSharpVersion, stripe: expectedStripeVersion }), lockSha256: actualHash });
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
  console.log(`Dependency assets verified: AWS S3 ${result.dependencies.awsS3}, nodemailer ${result.dependencies.nodemailer}, pg ${result.dependencies.pg}, sharp ${result.dependencies.sharp}, Stripe ${result.dependencies.stripe}, lock SHA-256 ${result.lockSha256}.`);
}

export const dependencyLockEvidence = Object.freeze({ expectedDriverVersion, expectedMailerVersion, expectedS3Version, expectedSharpVersion, expectedStripeVersion, expectedLockSha256, expectedDriverIntegrity, expectedMailerIntegrity, expectedS3ClientIntegrity, expectedS3PresignerIntegrity, expectedSharpIntegrity, expectedStripeIntegrity });

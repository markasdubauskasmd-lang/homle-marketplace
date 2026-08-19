import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// This is deliberately a content boundary, not a visual assertion. The active
// product objective says the Cleaner Dashboard must remain exactly as it is.
// Pinning the complete dedicated surface and the shared browser assets it loads
// makes an accidental change fail in CI before it can be merged or deployed.
const expectedFileCount = 89;
const expectedDigest = "ec7c0ec1fdf5f616dd1587aebf5c4924ffb17dcdba926bfc801a77b516b8009c";

const sharedBrowserDependencies = Object.freeze([
  "public/account-avatar.js",
  "public/account-menu.js",
  "public/active-job.html",
  "public/active-job.js",
  "public/active-job-model.js",
  "public/booking-summary-model.js",
  "public/homle-logo.png",
  "public/notification-badge.js",
  "public/notification-inbox-model.js",
  "public/postcode-map-core.js",
  "public/postcode-zone-centres.js",
  "public/request-json.js",
  "public/session-csrf.js",
  "public/site.webmanifest",
  "public/styles.css",
  "public/workspace-access.js"
]);

async function protectedFiles() {
  const [publicNames, marketplaceNames] = await Promise.all([
    readdir(path.join(repositoryRoot, "public")),
    readdir(path.join(repositoryRoot, "src", "marketplace"))
  ]);
  const files = [
    ...publicNames
      .filter((name) => name.startsWith("cleaner-") || name === "homle-cleaner.css")
      .map((name) => `public/${name}`),
    ...marketplaceNames
      .filter((name) => name.startsWith("cleaner-"))
      .map((name) => `src/marketplace/${name}`),
    ...sharedBrowserDependencies
  ];
  return [...new Set(files)].sort();
}

async function boundaryDigest(files) {
  const digest = createHash("sha256");
  for (const relativePath of files) {
    const bytes = await readFile(path.join(repositoryRoot, ...relativePath.split("/")));
    // Git may materialize tracked text as CRLF on Windows and LF on Linux.
    // Those are the same repository content, so normalize text before hashing;
    // binary assets remain byte-exact.
    const content = relativePath.endsWith(".png")
      ? bytes
      : Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
    const fileDigest = createHash("sha256").update(content).digest("hex");
    digest.update(relativePath);
    digest.update("\0");
    digest.update(fileDigest);
    digest.update("\n");
  }
  return digest.digest("hex");
}

const files = await protectedFiles();
assert.equal(files.length, expectedFileCount, "The protected Cleaner Dashboard file set changed. Do not add, remove or rename Cleaner Dashboard files under the no-change objective.");
assert.equal(
  await boundaryDigest(files),
  expectedDigest,
  "The Cleaner Dashboard or one of its shared browser dependencies changed. Revert the change; do not refresh this digest unless the user explicitly replaces the no-change objective."
);

console.log(`Cleaner Dashboard freeze passed: ${files.length} protected files are byte-for-byte unchanged.`);

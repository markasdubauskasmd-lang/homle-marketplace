import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// This is deliberately a content boundary, not a visual assertion. Pinning the
// complete dedicated surface and the shared browser assets it loads makes an
// accidental change fail in CI before it can be merged or deployed.
//
// The objective this boundary protected was "the Cleaner Dashboard must remain
// exactly as it is". The product owner explicitly replaced it with the
// design-unification objective: the whole signed-in product is to read as one
// system, which required the Cleaner surface to change. These values were
// refreshed under that instruction, not to make a failure go away.
//
// What was NOT authorised, and what this file still protects unchanged, is the
// shared backend below: which Cleaner is offered a job, on what terms, what
// they earn and whether it is dispatched automatically. That digest has not
// moved and must not be refreshed without the same explicit instruction.
//
// The count dropped from 90 to 88 when public/cleaner-reviews.{html,js} were
// removed. They were an orphan: no server route mapped to them, nothing in the
// product linked them, and cleaner-performance.html had already superseded them
// — it reads the same /api/marketplace/cleaners/{id}/reviews and carries the
// same data-reviews-* sockets, and /cleaner/reviews already routes there. The
// deletion removed a duplicate of a live screen, not a feature. The shared
// backend digest below was verified byte-identical across that change.
const expectedFileCount = 88;
const expectedDigest = "164a72b3a903d5deffb9e885889114ac62f64fb93349d39f817e9a71ff2bdf03";

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

// The visible Cleaner files are not the whole protected product boundary.
// These shared server modules decide which Cleaner is offered a job, the terms
// they see, what they earn and whether the request is dispatched automatically.
// Pinning this deliberately narrow set prevents a Landlord or pricing change
// from silently rewriting Cleaner behaviour while leaving the dashboard bytes
// untouched.
const sharedCleanerOutcomeDependencies = Object.freeze([
  "src/marketplace/automatic-dispatch-repository.mjs",
  "src/marketplace/automatic-dispatch-worker.mjs",
  "src/marketplace/booking-repository.mjs",
  "src/marketplace/booking-workflow.mjs",
  "src/marketplace/matching-repository.mjs",
  "src/marketplace/matching-service.mjs",
  "src/marketplace/pricing-economics.mjs",
  "src/marketplace/worker-attachment.mjs",
  "src/marketplace/worker-runtime.mjs"
]);

const expectedSharedBackendDigest = "a6f5375b9ed65905ce30ae550806280ebe9b8501094e52548fa84f258c79e017";

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

async function sharedBackendDigest() {
  return boundaryDigest(sharedCleanerOutcomeDependencies);
}

const files = await protectedFiles();
assert.equal(files.length, expectedFileCount, "The protected Cleaner Dashboard file set changed. Do not add, remove or rename Cleaner Dashboard files under the no-change objective.");
assert.equal(
  await boundaryDigest(files),
  expectedDigest,
  "The Cleaner Dashboard or one of its shared browser dependencies changed. Revert the change; do not refresh this digest unless the user explicitly replaces the no-change objective."
);
assert.equal(
  await sharedBackendDigest(),
  expectedSharedBackendDigest,
  "A shared module controlling Cleaner matching, job terms, payout or automatic dispatch changed. Revert it or isolate the non-Cleaner work; do not refresh this digest while the Cleaner backend freeze remains active."
);

console.log(`Cleaner Dashboard freeze passed: ${files.length} protected files and ${sharedCleanerOutcomeDependencies.length} shared Cleaner-outcome modules are byte-for-byte unchanged.`);

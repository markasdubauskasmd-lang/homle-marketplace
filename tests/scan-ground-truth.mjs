import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createScanGroundTruthRepository, createScanGroundTruthService } from "../src/marketplace/scan-ground-truth.mjs";

// The collection point that turns real traffic into a measured accuracy figure.
// What is tested here is the honesty layer: verdicts are validated before the
// database sees them, consent is an explicit attestation and never a default,
// and the report computes its statistics with the benchmark's own kappa so the
// synthetic and real measurements share one scale.

const administrator = { userId: "99999999-9999-4999-8999-999999999999", roles: ["administrator"] };
const landlord = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };
const objectId = "3c000000-0000-4000-8000-000000000042";

function repositoryStub(capture = {}, report = { labelledTotal: 0 }) {
  return {
    async listQueue(actor, limit) { capture.queueLimit = limit; return []; },
    async recordVerdict(actor, id, verdict) { capture.objectId = id; capture.verdict = verdict; return { groundTruthId: "id", objectId: id, ...verdict }; },
    async report() { return report; }
  };
}

async function rejects(work, fragment) {
  try { await work(); return false; }
  catch (error) { return String(error?.message || "").includes(fragment); }
}

/* ── Only an Administrator reviews accuracy ────────────────────────────── */

{
  const service = createScanGroundTruthService(repositoryStub());
  assert.ok(await rejects(() => service.getQueue(landlord, 10), "Administrator"), "A Landlord read the review queue.");
  assert.ok(await rejects(() => service.recordVerdict(landlord, objectId, {}), "Administrator"), "A Landlord recorded ground truth.");
  assert.ok(await rejects(() => service.getReport(landlord), "Administrator"), "A Landlord read the accuracy report.");
}

/* ── Verdicts are validated before the database sees them ──────────────── */

{
  const capture = {};
  const service = createScanGroundTruthService(repositoryStub(capture));
  await service.recordVerdict(administrator, objectId, {
    condition: " Medium ",
    soiling: ["grease", "GREASE", "food-debris", "not-a-kind"],
    labelCorrect: true,
    notes: "  standing   washing-up water  ",
    trainingConsented: "yes"
  });
  assert.equal(capture.verdict.condition, "medium", "The condition was not normalised.");
  assert.deepEqual([...capture.verdict.soiling], ["grease", "food-debris"], "Soiling kinds were not deduplicated and filtered to the taxonomy.");
  assert.equal(capture.verdict.notes, "standing washing-up water", "Notes were not bounded and normalised.");
  // Consent is an attestation. A truthy-but-not-true value must never count.
  assert.equal(capture.verdict.trainingConsented, false, "A non-boolean consent value was treated as consent.");

  assert.ok(await rejects(() => service.recordVerdict(administrator, objectId, { condition: "filthy", labelCorrect: true }), "clean, light, medium, heavy or unknown"),
    "An out-of-scale condition reached the database.");
  assert.ok(await rejects(() => service.recordVerdict(administrator, objectId, { condition: "clean" }), "name was correct"),
    "A verdict without the name judgement was accepted.");
  // 'unknown' is a real reviewer answer — "the photos cannot show it".
  await service.recordVerdict(administrator, objectId, { condition: "unknown", labelCorrect: false });
  assert.equal(capture.verdict.condition, "unknown", "The reviewer's own 'cannot tell' was rejected.");
}

/* ── The queue limit is bounded, with a sensible default ───────────────── */

{
  const capture = {};
  const service = createScanGroundTruthService(repositoryStub(capture));
  await service.getQueue(administrator);
  assert.equal(capture.queueLimit, 50, "The default queue size changed.");
  await service.getQueue(administrator, "5000");
  assert.equal(capture.queueLimit, 200, "The queue limit is unbounded.");
}

/* ── The report computes agreement with the benchmark's own kappa ──────── */

{
  const service = createScanGroundTruthService(repositoryStub({}, {
    labelledTotal: 10,
    labelCorrectCount: 9,
    trainingConsentedCount: 2,
    falseCleanCount: 2,
    conditionPairs: [
      { model: "clean", truth: "clean", count: 3 },
      // The dirty-sink cell: the model said clean, the reviewer says medium.
      { model: "clean", truth: "medium", count: 2 },
      { model: "medium", truth: "medium", count: 4 },
      // Unknowns are reported but excluded from kappa — the benchmark's rule.
      { model: "unknown", truth: "light", count: 1 }
    ]
  }));
  const report = await service.getReport(administrator);
  assert.equal(report.labelAccuracy, 0.9, "Label accuracy was not computed.");
  // 'clean' claimed 5 times, wrong twice: the precision of the one verdict
  // nobody rechecks on their own.
  assert.equal(report.falseCleanRate, 0.4, `The false-clean rate was ${report.falseCleanRate}.`);
  assert.equal(report.agreement.pairs, 9, "Unknown pairs leaked into the kappa sample.");
  assert.ok(report.agreement.kappa !== null && report.agreement.kappa > 0 && report.agreement.kappa < 1,
    `Kappa was not computed from the confusion counts: ${report.agreement.kappa}`);
  assert.equal(report.sufficient, false, "Ten labels were presented as a sufficient sample.");
}

// An empty report is the honest zero, not an error.
{
  const service = createScanGroundTruthService(repositoryStub({}, { labelledTotal: 0 }));
  const report = await service.getReport(administrator);
  assert.equal(report.labelledTotal, 0);
  assert.equal(report.labelAccuracy, null, "An accuracy with no denominator was invented.");
  assert.equal(report.falseCleanRate, null, "A false-clean rate with no clean verdicts was invented.");
}

/* ── The boundary matches the scans it derives from ────────────────────── */

assert.throws(() => createScanGroundTruthService({}), /complete scan ground-truth repository/, "An incomplete repository was accepted.");
assert.throws(() => createScanGroundTruthRepository(null), /database boundary/, "A missing database boundary was accepted.");

// Labels must die with the scan they describe, and the runtime role must have
// no direct path to the table.
const migration = readFileSync(new URL("../db/migrations/079_scan_ground_truth.sql", import.meta.url), "utf8");
assert.ok(/room_scan_object_id uuid NOT NULL UNIQUE REFERENCES room_scan_objects\(id\) ON DELETE CASCADE/.test(migration),
  "A ground-truth label can outlive the scan it describes, surviving retention purges and customer deletion.");
assert.ok(/training_consented boolean NOT NULL DEFAULT false/.test(migration), "Training consent defaults to something other than no.");
assert.ok(/ENABLE ROW LEVEL SECURITY/.test(migration), "The ground-truth table has no row-level security.");
const grants = readFileSync(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
assert.ok(/REVOKE SELECT, INSERT, UPDATE, DELETE ON room_scan_ground_truth FROM tideway_app/.test(grants),
  "The runtime role can reach reviewer verdicts directly instead of through the reviewed functions.");
assert.ok(/GRANT EXECUTE ON FUNCTION tideway_private\.record_scan_ground_truth/.test(grants), "The recording function is not granted to the runtime role.");

// The report is counts, never rows: no function returns a per-home listing.
assert.ok(!/scan_ground_truth_report[\s\S]{0,2400}cleaning_request_id/.test(migration.slice(migration.indexOf("scan_ground_truth_report"))),
  "The aggregate report exposes request identifiers.");

console.log("Scan ground-truth checks passed: administrator-only review, validated verdicts, consent as explicit attestation, benchmark-scale agreement statistics, cascade-bound retention and a function-only boundary.");

import { uuid } from "./validation.mjs";
import { isSoilingKind } from "./room-condition-vocabulary.mjs";
import { conditionAgreement } from "./scan-benchmark.mjs";

// Reviewed ground truth for the scanner's condition grading.
//
// Every phase since the audit has ended with the same honest limitation: the
// benchmark runs on synthetic fixtures, so the model's real accuracy — above
// all its false-clean rate — is unknowable. This module is the collection
// point that ends that. An internal reviewer records what an object's
// condition actually was; the report compares reviewer truth with model
// output, in aggregate, using the same Cohen's kappa the benchmark uses, so
// the synthetic and real measurements are on one scale.
//
// The boundary rules match the scans this derives from: the runtime role has
// no privilege on the table (see db/runtime-role-grants.sql), every statement
// is a reviewed SECURITY DEFINER call, labels cascade away with the scan they
// describe, and nothing here returns media, notes or transcripts.

function mapped(error, table) {
  const entry = table[error?.message];
  if (!entry) throw error;
  throw Object.assign(new Error(entry[2]), { statusCode: entry[0], code: entry[1], cause: error });
}

const errors = Object.freeze({
  "administrator-required": [403, "administrator-required", "An Administrator account is required to review scan accuracy."],
  "scan-object-not-found": [404, "scan-object-not-found", "That scanned object no longer exists."],
  "invalid-ground-truth": [422, "invalid-ground-truth", "That verdict is outside the supported shape."],
  "invalid-queue-limit": [422, "invalid-queue-limit", "The review queue limit is outside the supported range."]
});

export function createScanGroundTruthRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return Object.freeze({
    listQueue(actor, limit) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT tideway_private.list_scan_ground_truth_queue($1::integer) AS queue", [limit]);
          return result.rows[0]?.queue ?? [];
        } catch (error) { return mapped(error, errors); }
      });
    },
    recordVerdict(actor, objectId, verdict) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query(
            "SELECT tideway_private.record_scan_ground_truth($1::uuid,$2::text,$3::jsonb,$4::boolean,$5::text,$6::boolean) AS truth",
            [objectId, verdict.condition, JSON.stringify(verdict.soiling), verdict.labelCorrect, verdict.notes, verdict.trainingConsented]
          );
          return result.rows[0]?.truth ?? null;
        } catch (error) { return mapped(error, errors); }
      });
    },
    report(actor) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT tideway_private.scan_ground_truth_report() AS report");
          return result.rows[0]?.report ?? { labelledTotal: 0 };
        } catch (error) { return mapped(error, errors); }
      });
    }
  });
}

// The verdict conditions include 'unknown' deliberately: "this photo cannot
// show it" is a real reviewer answer, and recording it is what keeps the
// model's own 'unknown's honest instead of merely unmeasured.
const verdictConditions = Object.freeze(["clean", "light", "medium", "heavy", "unknown"]);

function normalizedVerdict(input = {}) {
  const condition = String(input.condition || "").toLowerCase().trim();
  if (!verdictConditions.includes(condition)) throw new TypeError("A reviewed condition must be clean, light, medium, heavy or unknown.");
  const soiling = [];
  for (const entry of Array.isArray(input.soiling) ? input.soiling : []) {
    const kind = String(entry || "").toLowerCase().trim();
    if (isSoilingKind(kind) && !soiling.includes(kind)) soiling.push(kind);
  }
  if (typeof input.labelCorrect !== "boolean") throw new TypeError("Say whether the object name was correct.");
  return Object.freeze({
    condition,
    soiling: Object.freeze(soiling.slice(0, 4)),
    labelCorrect: input.labelCorrect,
    notes: String(input.notes || "").replace(/\s+/g, " ").trim().slice(0, 500),
    // Consent to train is an attestation, never a default. Anything other than
    // an explicit true is false.
    trainingConsented: input.trainingConsented === true
  });
}

// Expands the aggregate confusion counts back into pairs so the benchmark's own
// kappa runs unchanged on real data — one implementation of agreement, one
// scale. Bounded, because kappa over the first fifty thousand labels answers
// the question as well as kappa over all of them.
const maximumExpandedPairs = 50_000;

function agreementFromPairs(conditionPairs) {
  const pairs = [];
  for (const entry of Array.isArray(conditionPairs) ? conditionPairs : []) {
    const count = Math.max(0, Math.min(Number(entry?.count) || 0, maximumExpandedPairs - pairs.length));
    for (let index = 0; index < count; index += 1) {
      pairs.push({ expected: entry.truth, observed: entry.model });
    }
    if (pairs.length >= maximumExpandedPairs) break;
  }
  return conditionAgreement(pairs);
}

export function createScanGroundTruthService(repository) {
  for (const method of ["listQueue", "recordVerdict", "report"]) {
    if (typeof repository?.[method] !== "function") throw new TypeError("A complete scan ground-truth repository is required.");
  }
  const requireAdministrator = (actor) => {
    if (!actor?.userId || !actor.roles?.includes("administrator")) throw new TypeError("An Administrator account is required to review scan accuracy.");
  };
  return Object.freeze({
    async getQueue(actor, limit) {
      requireAdministrator(actor);
      const bounded = Number.isInteger(Number(limit)) && Number(limit) >= 1 ? Math.min(200, Number(limit)) : 50;
      return await repository.listQueue(actor, bounded);
    },
    async recordVerdict(actor, objectId, input) {
      requireAdministrator(actor);
      return await repository.recordVerdict(actor, uuid(objectId, "scan object id"), normalizedVerdict(input));
    },
    async getReport(actor) {
      requireAdministrator(actor);
      const stored = await repository.report(actor);
      const labelledTotal = Number(stored?.labelledTotal) || 0;
      const labelCorrectCount = Number(stored?.labelCorrectCount) || 0;
      const falseCleanCount = Number(stored?.falseCleanCount) || 0;
      const conditionPairs = Array.isArray(stored?.conditionPairs) ? stored.conditionPairs : [];
      // How often "clean" was wrong, out of the times the model said it. This is
      // the precision of the one verdict nobody rechecks on their own, which is
      // why it is a headline figure rather than a cell in the matrix.
      const modelCleanTotal = conditionPairs
        .filter((entry) => entry?.model === "clean")
        .reduce((total, entry) => total + (Number(entry?.count) || 0), 0);
      return Object.freeze({
        labelledTotal,
        labelCorrectCount,
        labelAccuracy: labelledTotal ? Math.round((labelCorrectCount / labelledTotal) * 10000) / 10000 : null,
        trainingConsentedCount: Number(stored?.trainingConsentedCount) || 0,
        falseCleanCount,
        falseCleanRate: modelCleanTotal ? Math.round((falseCleanCount / modelCleanTotal) * 10000) / 10000 : null,
        conditionPairs: Object.freeze(conditionPairs.map((entry) => Object.freeze({ ...entry }))),
        agreement: agreementFromPairs(conditionPairs),
        // Nothing here is meaningful below a real sample. Said outright so a
        // kappa over nine labels is never quoted as the model's accuracy.
        sufficient: labelledTotal >= 50
      });
    }
  });
}

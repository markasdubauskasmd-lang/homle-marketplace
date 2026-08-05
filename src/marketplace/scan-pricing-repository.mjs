import { normalizedPricingRuleset } from "./scan-pricing.mjs";

// The database boundary for operator-configurable pricing rules.
//
// The runtime role has no direct privilege on scan_pricing_rulesets — see the
// REVOKE in db/runtime-role-grants.sql — so every read and write below is a
// reviewed SECURITY DEFINER call. A rate change is append-only and audited at
// the database, not here.

function mapped(error, table) {
  const entry = table[error?.message];
  if (!entry) throw error;
  throw Object.assign(new Error(entry[2]), { statusCode: entry[0], code: entry[1], cause: error });
}

const errors = Object.freeze({
  "invalid-pricing-addon": [422, "invalid-pricing-addon", "That add-on is outside the supported range."],
  "invalid-retention-policy": [422, "invalid-retention-policy", "That retention period is outside the supported range."],
  "authentication-required": [401, "authentication-required", "Sign in to view the pricing rules."],
  "administrator-required": [403, "administrator-required", "An Administrator account is required to change pricing rules."],
  "invalid-pricing-ruleset": [422, "invalid-pricing-ruleset", "One of those pricing values is outside the supported range."]
});

export function createScanPricingRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return Object.freeze({
    getActiveRuleset(actor, rulesetId) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT tideway_private.get_active_scan_pricing_ruleset($1::text) AS ruleset", [rulesetId]);
          // Null is a valid answer: an unconfigured deployment falls back to the
          // shipped defaults rather than failing to price.
          return result.rows[0]?.ruleset ?? null;
        } catch (error) { return mapped(error, errors); }
      });
    },
    publishRuleset(actor, rulesetId, rules, reason) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query(
            "SELECT tideway_private.publish_scan_pricing_ruleset($1::text,$2::jsonb,$3::text) AS ruleset",
            [rulesetId, JSON.stringify(rules), reason]
          );
          return result.rows[0]?.ruleset ?? null;
        } catch (error) { return mapped(error, errors); }
      });
    },
    // Best-effort by construction: the database function returns false rather
    // than raising for a malformed observation, and a failure here is swallowed
    // by the caller. This measures the estimate; it is not the estimate, and it
    // must never fail the read that produced it.
    recordObservation(actor, cleaningRequestId, estimate) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query(
          "SELECT tideway_private.record_scan_estimate_observation($1::uuid,$2::text,$3::integer,$4::integer,$5::smallint,$6::integer,$7::boolean,$8::integer,$9::integer,$10::integer,$11::text) AS recorded",
          [cleaningRequestId, estimate.rulesetId, estimate.rulesetVersion, estimate.complexityModelVersion ?? 1,
            estimate.complexityLevel ?? 0, estimate.labourMinutes ?? 0, estimate.priceable === true,
            estimate.totalPence ?? 0, estimate.lowPence ?? 0, estimate.highPence ?? 0, estimate.code ?? ""]
        );
        return result.rows[0]?.recorded === true;
      });
    },
    listAddons(actor) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT tideway_private.list_scan_pricing_addons() AS addons");
          return result.rows[0]?.addons ?? [];
        } catch (error) { return mapped(error, errors); }
      });
    },
    upsertAddon(actor, addon) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query(
            "SELECT tideway_private.upsert_scan_pricing_addon($1::text,$2::text,$3::integer,$4::integer,$5::boolean) AS addons",
            [addon.code, addon.label, addon.pence, addon.addedMinutes, addon.active]
          );
          return result.rows[0]?.addons ?? [];
        } catch (error) { return mapped(error, errors); }
      });
    },
    getRetention(actor) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT tideway_private.get_scan_retention_policy() AS policy");
          return result.rows[0]?.policy ?? null;
        } catch (error) { return mapped(error, errors); }
      });
    },
    setRetention(actor, policy) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query(
            "SELECT tideway_private.set_scan_retention_policy($1::integer,$2::integer) AS policy",
            [policy.abandonedDays, policy.completedDays]
          );
          return result.rows[0]?.policy ?? null;
        } catch (error) { return mapped(error, errors); }
      });
    },
    shadowReport(actor, rulesetId, modelVersion) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query(
            "SELECT tideway_private.scan_estimate_shadow_report($1::text,$2::integer) AS report",
            [rulesetId, modelVersion]
          );
          return result.rows[0]?.report ?? null;
        } catch (error) { return mapped(error, errors); }
      });
    },
    listRulesets(actor, rulesetId, limit) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT tideway_private.list_scan_pricing_rulesets($1::text,$2::integer) AS history", [rulesetId, limit]);
          return result.rows[0]?.history ?? { rulesetId, versions: [] };
        } catch (error) { return mapped(error, errors); }
      });
    }
  });
}

export function createScanPricingService(repository) {
  if (!repository || typeof repository.getActiveRuleset !== "function" || typeof repository.publishRuleset !== "function"
    || typeof repository.listRulesets !== "function" || typeof repository.recordObservation !== "function"
    || typeof repository.shadowReport !== "function" || typeof repository.listAddons !== "function"
    || typeof repository.upsertAddon !== "function" || typeof repository.setRetention !== "function" || typeof repository.getRetention !== "function") {
    throw new TypeError("A complete scan-pricing repository is required.");
  }
  const rulesetName = (value) => {
    const supplied = String(value || "default").trim().toLowerCase();
    if (!/^[a-z0-9-]{1,40}$/.test(supplied)) throw new TypeError("Choose a supported pricing ruleset.");
    return supplied;
  };
  return Object.freeze({
    async getActiveRuleset(actor, rulesetId) {
      if (!actor?.userId) throw new TypeError("Sign in to view the pricing rules.");
      return repository.getActiveRuleset(actor, rulesetName(rulesetId));
    },
    async publishRuleset(actor, rulesetId, input = {}) {
      if (!actor?.userId || !actor.roles?.includes("administrator")) throw new TypeError("An Administrator account is required to change pricing rules.");
      const reason = String(input.changeReason || "").trim();
      // A rate change with no stated reason is the one nobody can explain six
      // months later, so it is refused here as well as at the database.
      if (reason.length < 10 || reason.length > 500) throw new TypeError("Say why these rates are changing, in 10 to 500 characters.");
      // Validated in JavaScript before it reaches SQL so an operator gets a
      // message naming the field, rather than a generic constraint failure.
      const rules = normalizedPricingRuleset({ ...input.rules, rulesetId: rulesetName(rulesetId) });
      return repository.publishRuleset(actor, rulesetName(rulesetId), rules, reason);
    },
    // Records what the estimate said, so its error against the price a Cleaner
    // actually accepted accrues from ordinary trading rather than from a
    // labelling exercise. Swallows every failure: an estimate that could not be
    // measured is a lost data point, not a broken read.
    async recordObservation(actor, cleaningRequestId, estimate) {
      if (!actor?.userId || !estimate) return false;
      try { return await repository.recordObservation(actor, cleaningRequestId, estimate); }
      catch { return false; }
    },
    async listAddons(actor) {
      if (!actor?.userId) throw new TypeError("Sign in to view the available extras.");
      return repository.listAddons(actor);
    },
    async upsertAddon(actor, input = {}) {
      if (!actor?.userId || !actor.roles?.includes("administrator")) throw new TypeError("An Administrator account is required to change extras.");
      const code = String(input.code || "").trim().toLowerCase();
      if (!/^[a-z0-9-]{2,40}$/.test(code)) throw new TypeError("An extra needs a short code of letters, numbers and hyphens.");
      const label = String(input.label || "").trim();
      if (label.length < 2 || label.length > 80) throw new TypeError("An extra needs a name of 2 to 80 characters.");
      const pence = Number(input.pence);
      if (!Number.isInteger(pence) || pence < 1 || pence > 100000) throw new TypeError("An extra must cost between £0.01 and £1,000.00.");
      const addedMinutes = Number.isInteger(Number(input.addedMinutes)) ? Number(input.addedMinutes) : 0;
      if (addedMinutes < 0 || addedMinutes > 480) throw new TypeError("An extra may add between 0 and 480 minutes.");
      return repository.upsertAddon(actor, { code, label, pence, addedMinutes, active: input.active !== false });
    },
    async getRetention(actor) {
      if (!actor?.userId) throw new TypeError("Sign in to view the retention policy.");
      return repository.getRetention(actor);
    },
    async setRetention(actor, input = {}) {
      if (!actor?.userId || !actor.roles?.includes("administrator")) throw new TypeError("An Administrator account is required to change retention.");
      const abandonedDays = Number(input.abandonedDays);
      const completedDays = Number(input.completedDays);
      for (const [value, label] of [[abandonedDays, "Unbooked scan retention"], [completedDays, "Booked scan retention"]]) {
        if (!Number.isInteger(value) || value < 1 || value > 3650) throw new TypeError(`${label} must be between 1 and 3650 days.`);
      }
      // A scan a Cleaner worked from is the evidence in any dispute about what was
      // agreed, so it cannot be kept for less time than one nobody ever used.
      if (completedDays < abandonedDays) throw new TypeError("Booked scans cannot be deleted sooner than unbooked ones.");
      return repository.setRetention(actor, { abandonedDays, completedDays });
    },
    async shadowReport(actor, rulesetId, modelVersion) {
      if (!actor?.userId || !actor.roles?.includes("administrator")) throw new TypeError("An Administrator account is required to view the shadow report.");
      const version = Number.isInteger(Number(modelVersion)) ? Number(modelVersion) : null;
      return repository.shadowReport(actor, rulesetName(rulesetId), version);
    },
    async listRulesets(actor, rulesetId, limit) {
      if (!actor?.userId || !actor.roles?.includes("administrator")) throw new TypeError("An Administrator account is required to view pricing history.");
      const bounded = Number.isInteger(Number(limit)) ? Math.max(1, Math.min(100, Number(limit))) : 20;
      return repository.listRulesets(actor, rulesetName(rulesetId), bounded);
    }
  });
}

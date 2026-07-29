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
    || typeof repository.listRulesets !== "function") {
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
    async listRulesets(actor, rulesetId, limit) {
      if (!actor?.userId || !actor.roles?.includes("administrator")) throw new TypeError("An Administrator account is required to view pricing history.");
      const bounded = Number.isInteger(Number(limit)) ? Math.max(1, Math.min(100, Number(limit))) : 20;
      return repository.listRulesets(actor, rulesetName(rulesetId), bounded);
    }
  });
}

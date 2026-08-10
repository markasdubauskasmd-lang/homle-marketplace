// Reading and publishing the operator's price list.
//
// Everything goes through the SECURITY DEFINER functions in migration 094: the
// runtime holds no direct privilege on pricing_configurations, so a query that
// escapes its intended shape still cannot read the economics of every version
// or rewrite a retired one.
//
// Three readers rather than one, because they are three different audiences:
//
//   * activeConfig()          — the customer-facing price list. Served to a
//                               browser. Carries no commercial position.
//   * economicsForRuntime()   — the floors, for the server to decide whether a
//                               quote is one Homle will sell at. The customer
//                               never sees the answer, only its consequence.
//   * activeWithEconomics()   — both, administrator only, for the pricing page.
//
// Nothing configured is not an error anywhere here. It returns null and the
// caller falls back to the shipped defaults, which are a complete working price
// list — a deployment that has never opened the pricing page quotes the same
// numbers as one that has.

const errorCodes = new Map([
  ["authentication-required", [401, "authentication-required", "Sign in to read pricing."]],
  ["administrator-required", [403, "administrator-required", "Only an administrator can change pricing."]],
  ["invalid-pricing-configuration", [422, "invalid-pricing-configuration", "That pricing configuration is outside the supported range."]]
]);

function translated(error) {
  const mapped = errorCodes.get(String(error?.message || ""));
  if (!mapped) return error;
  const [statusCode, code, message] = mapped;
  return Object.assign(new Error(message), { statusCode, code });
}

export function createPricingConfigurationRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("A marketplace database is required.");

  function callAsActor(actor, sql, parameters) {
    return database.withUserTransaction(actor, async (client) => {
      try {
        const result = await client.query(sql, parameters);
        return result.rows[0]?.value ?? null;
      } catch (error) {
        throw translated(error);
      }
    });
  }

  return Object.freeze({
    /** The customer-facing price list, or null when nothing is configured. */
    async activeConfig(actor, configId = "default") {
      const row = await callAsActor(actor, "SELECT tideway_private.get_active_pricing_config($1::text) AS value", [configId]);
      return row?.config ?? null;
    },

    /** The floors the server prices against. Never returned to a browser. */
    async economicsForRuntime(actor, configId = "default") {
      return callAsActor(actor, "SELECT tideway_private.get_pricing_economics_for_runtime($1::text) AS value", [configId]);
    },

    /** Both halves, for the pricing page. Administrator only. */
    async activeWithEconomics(actor, configId = "default") {
      return callAsActor(actor, "SELECT tideway_private.get_active_pricing_economics($1::text) AS value", [configId]);
    },

    /**
     * Publishes a new version and retires the previous one.
     *
     * The caller has already validated both halves with
     * normalizedPricingConfig/normalizedPricingEconomics — this stores the
     * result of that validation, never raw operator input.
     */
    async publish(actor, { configId = "default", config, economics, changeReason }) {
      return callAsActor(
        actor,
        "SELECT tideway_private.publish_pricing_configuration($1::text,$2::jsonb,$3::jsonb,$4::text) AS value",
        [configId, JSON.stringify(config), JSON.stringify(economics), String(changeReason || "")]
      );
    }
  });
}

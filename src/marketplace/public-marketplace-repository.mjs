// The anonymous side of the marketplace (migration 137): a visitor's price
// list, quote floors, coverage answer and launch-news consent. No user context
// exists, so every call runs as the runtime role with none, through one
// SECURITY DEFINER function each.

const errors = new Map([
  ["invalid-postcode", [422, "invalid-postcode", "Enter a full UK postcode, such as SW1A 1AA, or its first half."]],
  ["invalid-email", [422, "invalid-email", "Enter an email address we can reach you on."]],
  ["consent-required", [422, "consent-required", "Tick the box to agree to launch news."]],
  ["administrator-required", [403, "administrator-required", "Only an administrator can read this."]]
]);

function mapped(error) {
  const known = errors.get(String(error?.message || ""));
  return known ? Object.assign(new Error(known[2]), { statusCode: known[0], code: known[1], cause: error }) : error;
}

export function createPublicMarketplaceRepository(database) {
  if (!database || typeof database.withAuthenticationTransaction !== "function" || typeof database.withUserTransaction !== "function") {
    throw new TypeError("The marketplace database boundary is required.");
  }
  const anonymous = (sql, values) => database.withAuthenticationTransaction(async (client) => {
    try { return (await client.query(sql, values)).rows[0]?.value ?? null; }
    catch (error) { throw mapped(error); }
  });
  return Object.freeze({
    pricingConfig: (configId = "default") => anonymous("SELECT tideway_private.get_public_pricing_config($1::text) AS value", [configId]),
    // Server-side only: the floors that decide whether a quote is priceable.
    pricingEconomics: (configId = "default") => anonymous("SELECT tideway_private.get_public_pricing_economics($1::text) AS value", [configId]),
    coverage: (postcode, requirePayoutReady) => anonymous("SELECT tideway_private.public_cleaner_coverage($1::text,$2::boolean) AS value", [postcode, requirePayoutReady === true]),
    recordLaunchInterest: (postcode, email, consentVersion) => anonymous("SELECT tideway_private.record_launch_interest($1::text,$2::text,$3::text) AS value", [postcode, email, consentVersion]),
    administratorLaunchInterest: (actor) => database.withUserTransaction(actor, async (client) => {
      try { return (await client.query("SELECT tideway_private.get_administrator_launch_interest() AS value")).rows[0]?.value ?? []; }
      catch (error) { throw mapped(error); }
    })
  });
}

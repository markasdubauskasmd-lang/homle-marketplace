import assert from "node:assert/strict";
import { createRateLimitBoundary } from "../src/marketplace/rate-limit-boundary.mjs";

const calls = [];
const monitored = [];
let decision = { allowed: true };
let key = "198.51.100.42";
let keyResolutions = 0;
const limiter = { async consume(input) { calls.push(input); if (decision instanceof Error) throw decision; return decision; } };
const limit = createRateLimitBoundary(limiter, () => { keyResolutions += 1; return key; }, { onUnexpectedError(error) { monitored.push(error); } });

const firstRequest = {};
await limit(firstRequest, "marketplace-public:cleaner-directory");
assert.deepEqual(calls.at(-1), { scope: "marketplace-public:cleaner-directory", key: "198.51.100.42" });
assert.equal(limit.clientKey(firstRequest), "198.51.100.42");
assert.equal(keyResolutions, 1, "one request must retain one trusted key across limiting and metadata hashing");

decision = { allowed: false, retryAfterSeconds: 99999 };
await assert.rejects(() => limit({}, "marketplace-public:cleaner-reviews"), (error) => error.statusCode === 429 && error.code === "rate-limited" && error.retryAfterSeconds === 3600);

decision = undefined;
await assert.rejects(() => limit({}, "marketplace-public:cleaner-directory"), (error) => error.statusCode === 503 && error.code === "abuse-control-unavailable" && !error.message.includes("invalid decision"));
assert.ok(monitored.at(-1) instanceof TypeError && monitored.at(-1).message.includes("invalid decision"));

const limiterFailure = new Error("private limiter outage detail");
decision = limiterFailure;
await assert.rejects(() => limit({}, "login"), (error) => error.statusCode === 503 && error.code === "abuse-control-unavailable" && !error.message.includes("private limiter outage detail"));
assert.equal(monitored.at(-1), limiterFailure);

decision = { allowed: true };
key = "";
await assert.rejects(() => limit({}, "login"), (error) => error.statusCode === 503 && error.code === "abuse-control-unavailable");
assert.ok(monitored.at(-1) instanceof TypeError && monitored.at(-1).message.includes("client key"));

assert.throws(() => createRateLimitBoundary(null, () => "key"), /shared rate limiter/);
assert.throws(() => createRateLimitBoundary(limiter, null), /client-key resolver/);

console.log("Rate-limit boundary tests passed: trusted keys, scoped decisions, bounded retry, fail-closed outages and private monitoring.");

// The two money-path writes. Every authentication endpoint and every endpoint
// that calls a metered AI provider was limited; creating a cleaning request and
// creating a booking invitation were not, so one authenticated session could
// create either without bound. Each invitation is work a real Cleaner may be
// asked to answer.
{
  const { readFile } = await import("node:fs/promises");
  const limiterMigration = await readFile(new URL("../db/migrations/119_booking_write_rate_limits.sql", import.meta.url), "utf8");
  const httpSource = await readFile(new URL("../src/marketplace/marketplace-http.mjs", import.meta.url), "utf8");
  for (const scope of ["marketplace-landlord:cleaning-request", "marketplace-landlord:booking"]) {
    if (!limiterMigration.includes(`'${scope}'`)) throw new Error(`The limiter has no ${scope} scope, so the endpoint cannot be limited.`);
    // A scope in the CHECK constraint with no policy row raises
    // rate-limit-scope-unsupported at runtime, which fails the request closed
    // rather than limiting it.
    if (!new RegExp(`\\('${scope}',\\d+,\\d+\\)`).test(limiterMigration)) throw new Error(`${scope} is allowed by the constraint but has no policy, so every call would be refused.`);
    if (!httpSource.includes(`limitPublicRead(request, "${scope}")`)) throw new Error(`Nothing charges a request against ${scope}, so the scope exists and is never used.`);
  }
  // The limit must be taken before the write, not after it.
  const requestRoute = httpSource.slice(httpSource.indexOf('pathname === "/api/marketplace/cleaning-requests"'), httpSource.indexOf("const selectedRequestSubmission"));
  if (requestRoute.indexOf("marketplace-landlord:cleaning-request") > requestRoute.indexOf("createOwnRequest")) throw new Error("The cleaning-request limit is charged after the record is created, which limits nothing.");
  const inviteRoute = httpSource.slice(httpSource.indexOf("const selectedInvitationRequest"), httpSource.indexOf("const selectedAutomaticDispatchRequest"));
  if (inviteRoute.indexOf("marketplace-landlord:booking") > inviteRoute.indexOf("inviteCleaner")) throw new Error("The booking limit is charged after the invitation is created, which limits nothing.");
  // Generous for honest use: somebody managing a portfolio may legitimately
  // create several requests in one sitting.
  for (const [scope, minimum] of [["marketplace-landlord:cleaning-request", 10], ["marketplace-landlord:booking", 10]]) {
    const allowance = Number(limiterMigration.match(new RegExp(`\\('${scope}',(\\d+),\\d+\\)`))[1]);
    if (allowance < minimum) throw new Error(`${scope} allows only ${allowance} per window, which would stop a real landlord working.`);
  }
  console.log("Booking write rate-limit tests passed: both money-path writes have a scope, a policy and a charge taken before the record is created, with an allowance that leaves a real landlord alone.");
}

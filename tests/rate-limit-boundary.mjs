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

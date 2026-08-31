/*
 * The per-account allowance on authenticated marketplace writes, and the two
 * kinds of route that must NOT spend it.
 *
 * tests/account-security.mjs proves the module honours an allowance it is
 * handed. That is not the same as proving the application hands it one: with
 * that test alone, deleting the `onMutation:` line from runtime.mjs reverts the
 * whole thing and the entire gate stays green. An independent reviewer found
 * exactly that gap. So the wiring is asserted here.
 *
 * Some of these are source assertions rather than behavioural ones, which is a
 * real weakness and worth naming: composing the marketplace runtime needs a
 * live PostgreSQL cluster and a session repository, so a unit test cannot build
 * it. The behavioural half — that `allowance: false` is honoured at all — is
 * exercised for real below.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAccountSecurity } from "../src/marketplace/account-security.mjs";
import { createSessionMaterial, sessionCookieName } from "../src/marketplace/session.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/* ── Behaviour: the opt-out is real ── */

const secret = "mutation-allowance-test-secret-longer-than-32-characters";
const material = createSessionMaterial(secret, new Date("2026-07-15T15:00:00.000Z"), 3600);
const session = {
  session_id: "session-id",
  user_id: "22222222-2222-4222-8222-222222222222",
  email: "landlord@example.com",
  email_verified_at: "2026-07-15T14:00:00.000Z",
  display_name: "Landlord Example",
  avatar_url: null,
  selected_role: "landlord",
  roles: ["landlord"],
  csrf_secret_hash: material.csrfHash,
  expires_at: material.expiresAt
};
const charged = [];
const security = createAccountSecurity(
  { async findSession(hash) { return hash.equals(material.tokenHash) ? session : null; } },
  {
    sessionSecret: secret,
    appOrigin: "https://tideway.example.com",
    production: true,
    onMutation: async (context) => { charged.push(context.actor.userId); }
  }
);
const request = { headers: { cookie: `${sessionCookieName}=${material.token}`, origin: "https://tideway.example.com", "x-csrf-token": material.csrfToken } };

await security.protect(request, { mutation: true, roles: ["landlord"] });
assert.equal(charged.length, 1, "A normal authenticated write did not spend the account's allowance.");

await security.protect(request, { mutation: true, allowance: false, roles: ["landlord"] });
assert.equal(charged.length, 1, "`allowance: false` still spent the account's allowance, so sign-out and the compute-only routes remain blockable by an abuse control.");

await security.protect(request, { mutation: true, allowance: true, roles: ["landlord"] });
assert.equal(charged.length, 2, "An explicit `allowance: true` stopped charging. Only `false` may opt out; anything else must charge.");

/* ── Wiring: the application actually supplies an allowance ── */

const runtime = read("src/marketplace/runtime.mjs");
assert.match(
  runtime,
  /onMutation:\s*\(context\)\s*=>\s*limitMutation\(context\.actor,\s*"marketplace:mutation"\)/,
  "The marketplace runtime no longer hands account-security a mutation allowance. Without this line every authenticated write is unthrottled again, and no other test in the tree would notice."
);
assert.match(
  runtime,
  /createRateLimitBoundary\(options\.rateLimiter,\s*\(actor\)\s*=>\s*`account:\$\{actor\.userId\}`/,
  "The mutation allowance is no longer keyed by account. Keyed by address instead, an office or carrier NAT puts unrelated people in one bucket — the exact reason this limit is not the IP-keyed kind."
);

/* ── Sign-out must never be blocked by an abuse control ── */

const authentication = read("src/marketplace/authentication-http.mjs");
const logoutRoute = authentication.slice(authentication.indexOf("}logout` || url.pathname === `${prefix}logout-all`"));
assert.match(
  logoutRoute.slice(0, 400),
  /protect\(request,\s*\{[^}]*allowance:\s*false/,
  "Sign-out spends the mutation allowance again. Measured before this was fixed: an account at its limit received 429 from POST /auth/logout. Somebody who believes their account is compromised must always be able to end their sessions."
);

/* ── Routes that write nothing must not spend a write budget ── */

// Each carries `mutation: true` for the CSRF and origin checks and writes
// nothing. Three are compute-only routes that already spend a read allowance of
// their own — charging them twice let one scan review, which re-previews on
// every object correction, burn a third of the write budget without writing
// anything. The fourth is the Landlord notification stream, which a browser
// opens on every page load and reopens on every reconnect; spending a write
// from a customer's budget to receive notifications is not a write at all.
const marketplace = read("src/marketplace/marketplace-http.mjs");
assert.equal(
  (marketplace.match(/mutation:\s*true,\s*allowance:\s*false/g) || []).length,
  4,
  "The number of compute-only marketplace routes opting out of the write allowance changed. If a route was added, confirm it stores nothing and carries its own read allowance; if one was removed, confirm it now genuinely writes."
);

/* ── The database policy and the table's ceiling must agree ── */

// The counter is clamped to `maximum_requests + 1`, so the CHECK on
// request_count has to cover the largest policy. It did not when a 300 policy
// was added against a ceiling of 121: every write past 121 failed the CHECK and
// answered 503 "abuse control unavailable" — a total write outage from a limit
// that was supposed to allow 300. It was fixed by hand and left without a
// guard, so adding a scope with a higher maximum would reproduce it exactly.
const migration = read("db/migrations/105_marketplace_mutation_rate_limit.sql");
const ceiling = Number(/request_count BETWEEN 1 AND (\d+)/.exec(migration)?.[1]);
assert.ok(Number.isInteger(ceiling), "Migration 105 no longer states the request_count ceiling, so nothing can check it covers the policies.");
const maximums = [...migration.matchAll(/\('[a-z0-9:-]+',\s*(\d+),\s*\d+\)/g)].map((match) => Number(match[1]));
assert.ok(maximums.length >= 24, `Only ${maximums.length} rate-limit policies were parsed from migration 105; the assertion below would be checking almost nothing.`);
const largest = Math.max(...maximums);
assert.ok(
  ceiling >= largest + 1,
  `The request_count CHECK ceiling (${ceiling}) is below the largest rate-limit policy plus one (${largest + 1}). The counter clamps to maximum+1, so every request past ${ceiling} would fail the CHECK and answer 503 instead of being allowed or cleanly refused.`
);

console.log(`Mutation allowance tests passed: \`allowance: false\` genuinely opts out and only \`false\` does; the runtime supplies the allowance keyed by account under scope marketplace:mutation; sign-out and the four non-writing routes are exempt; and the request_count ceiling (${ceiling}) covers the largest of the ${maximums.length} policies (${largest}).`);

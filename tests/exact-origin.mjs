import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { exactOrigin } from "../src/marketplace/validation.mjs";
import { createFacebookLoginProvider } from "../src/marketplace/facebook-login.mjs";
import { createGoogleOidcProvider } from "../src/marketplace/google-oidc.mjs";
import { createProviderLinkState } from "../src/marketplace/provider-link-state.mjs";

// This rule decides which origin OAuth redirects and sign-in callbacks may target. It was
// written out seven times, once per module that accepts an application origin from
// configuration — six byte-identical copies plus Apple's HTTPS-only variant. Seven copies
// of a security check is seven chances for one to drift, and a divergence here is worth
// more to an attacker than almost anywhere else in the codebase.

const message = "A test subject requires an exact application origin.";

/* ── Accepted ── */

for (const [input, expected] of [
  ["https://homle.example", "https://homle.example"],
  // A trailing slash is the ordinary way an origin gets written in a config file.
  // `URL.origin` never carries one, which is what the strip in the guard is for.
  ["https://homle.example/", "https://homle.example"],
  ["https://homle.example:8443", "https://homle.example:8443"],
  ["http://localhost:3000", "http://localhost:3000"]
]) {
  assert.equal(exactOrigin(input, message), expected, `A legitimate origin was rejected: ${input}`);
}

/* ── Rejected ── */

const rejected = [
  ["https://homle.example/callback", "a path was silently truncated to its origin instead of being rejected"],
  ["https://homle.example/?next=x", "a query string was accepted"],
  ["https://homle.example/#fragment", "a fragment was accepted"],
  ["https://attacker@homle.example", "a username was smuggled into the origin"],
  ["https://user:secret@homle.example", "credentials were smuggled into the origin"],
  ["not a url", "an unparseable value was accepted"],
  ["", "an empty value was accepted"],
  [null, "null was accepted"],
  ["//homle.example", "a protocol-relative value was accepted"],
  ["javascript:alert(1)", "a javascript: URL was accepted"]
];

for (const [input, why] of rejected) {
  assert.throws(() => exactOrigin(input, message), (error) => error instanceof TypeError && error.message === message, `Exact-origin validation let a dangerous value through — ${why}: ${JSON.stringify(input)}`);
}

/* ── The HTTPS-only variant ── */

assert.equal(exactOrigin("https://homle.example", message, { requireHttps: true }), "https://homle.example", "The HTTPS variant rejected a valid HTTPS origin.");
assert.throws(() => exactOrigin("http://homle.example", message, { requireHttps: true }), TypeError, "The HTTPS variant accepted a plaintext origin. Apple sign-in requires HTTPS.");
// Without the flag, plaintext stays acceptable — local development runs on http://localhost.
assert.equal(exactOrigin("http://localhost:3000", message), "http://localhost:3000", "The default variant stopped accepting a plaintext origin, which breaks local development.");

/* ── Each wrapper still delegates, with its own subject in the message ── */

// The shared helper being right is not enough: a wrapper could pass the wrong message, or
// lose Apple's `requireHttps`, and the tests above would not notice. These construct the
// real modules with an origin carrying a path — the case the rule exists to reject — and
// assert the exact message an operator would read when the service refuses to start.
const wrappers = [
  ["provider-link-state", createProviderLinkState, { secret: "s".repeat(40) }, "Provider connection state requires an exact application origin."],
  ["facebook-login", createFacebookLoginProvider, { appId: "123456789012345", appSecret: "a".repeat(32), graphVersion: "v99.0", stateSecret: "s".repeat(40) }, "Facebook sign-in requires an exact application origin."],
  ["google-oidc", createGoogleOidcProvider, { clientId: "client.apps.googleusercontent.com", clientSecret: "s".repeat(40), stateSecret: "x".repeat(40) }, "Google sign-in requires an exact application origin."]
];

for (const [label, create, options, expected] of wrappers) {
  assert.throws(
    () => create({ ...options, appOrigin: "https://homle.example/callback" }),
    (error) => error instanceof TypeError && error.message === expected,
    `${label} no longer rejects an origin carrying a path, or no longer names itself in the message an operator reads when the service refuses to start.`
  );
  // And it still accepts a good one — a wrapper that rejected everything would pass the
  // assertion above for the wrong reason.
  assert.doesNotThrow(() => create({ ...options, appOrigin: "https://homle.example" }), `${label} rejects a valid origin.`);
}

// The remaining four wrappers are pinned by their own suites rather than duplicated here:
// `apple-sign-in` covers the HTTPS-only variant directly (tests/apple-sign-in.mjs asserts
// /exact HTTPS/ for an http:// origin), and `account-security`, `authentication-http` and
// `facebook-data-deletion` validate their repositories before the origin, so reaching the
// check needs those suites' full dependency fixtures. The source scan below is what stops
// any of the seven quietly growing a second implementation.

/* ── Nobody has quietly reintroduced a local copy ── */

// Each call site keeps a thin named wrapper so its error message still names its own
// subject; what must not come back is a second implementation of the rule itself.
const marketplace = "src/marketplace";
const reintroduced = [];
for (const name of readdirSync(new URL(`../${marketplace}`, import.meta.url))) {
  if (!name.endsWith(".mjs") || name === "validation.mjs") continue;
  const source = readFileSync(new URL(`../${marketplace}/${name}`, import.meta.url), "utf8");
  // The distinguishing line of the rule. A wrapper delegating to the shared owner does
  // not contain it; a fresh local copy does.
  if (/url\.origin !== String\(value\)|parsed\.origin !== String\(value\)/.test(source)) reintroduced.push(name);
}
assert.deepEqual(reintroduced, [], `These modules carry their own copy of the exact-origin rule again. It decides which origin sign-in callbacks may target, so it has one owner in ${marketplace}/validation.mjs — import \`exactOrigin\` instead:\n  ${reintroduced.join("\n  ")}`);

console.log("Exact-origin tests passed: paths, queries, fragments and smuggled credentials are rejected, trailing slashes and non-default ports are accepted, the HTTPS-only variant holds, three wrappers still reject a path-bearing origin with their own subject in the message, and no module has reintroduced its own copy of the rule.");

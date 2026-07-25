import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { exactOrigin } from "../src/marketplace/validation.mjs";

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

console.log("Exact-origin tests passed: paths, queries, fragments and smuggled credentials are rejected, trailing slashes and non-default ports are accepted, the HTTPS-only variant holds, and no module has reintroduced its own copy of the rule.");

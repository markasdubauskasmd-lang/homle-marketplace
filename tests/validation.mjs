import assert from "node:assert/strict";
import { uuid, uuidPattern } from "../src/marketplace/validation.mjs";
import { errorResponse } from "../src/marketplace/http-support.mjs";

// One id shape, shared by 30 modules. What matters is not only which strings it accepts,
// but that a rejection reaches the caller as 422 and not 500 — the guard throws
// TypeError specifically so `errorResponse` can tell "you sent something invalid" apart
// from "we broke". If that link is ever severed, malformed input starts reading as a
// server fault and the real cause disappears into a generic message.

const canonical = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/* ── Accepted ── */

assert.equal(uuid(canonical, "Booking id"), canonical, "A valid v4 UUID was rejected.");
// Case is normalised so the same id cannot arrive as two different keys.
assert.equal(uuid(canonical.toUpperCase(), "Booking id"), canonical, "An uppercase UUID was not normalised to lower case.");
// Versions 1-5 are all accepted; the schema's own ids are v4, but tokens minted
// elsewhere may not be.
for (const version of ["1", "2", "3", "4", "5"]) {
  const value = `3f2504e0-4f89-${version}1d3-9a0c-0305e82c3301`;
  assert.equal(uuid(value, "id"), value, `A version-${version} UUID was rejected.`);
}
// Variant nibble: 8, 9, a and b are the RFC 4122 variants.
for (const variant of ["8", "9", "a", "b"]) {
  const value = `3f2504e0-4f89-41d3-${variant}a0c-0305e82c3301`;
  assert.equal(uuid(value, "id"), value, `Variant "${variant}" was rejected.`);
}

/* ── Rejected ── */

const rejected = {
  "empty string": "",
  "null": null,
  "undefined": undefined,
  "a number": 42,
  "no hyphens": "3f2504e04f8941d39a0c0305e82c3301",
  "too short": "3f2504e0-4f89-41d3-9a0c-0305e82c330",
  "too long": "3f2504e0-4f89-41d3-9a0c-0305e82c33011",
  "non-hex character": "3f2504e0-4f89-41d3-9a0c-0305e82c330g",
  "version 0": "3f2504e0-4f89-01d3-9a0c-0305e82c3301",
  "version 6": "3f2504e0-4f89-61d3-9a0c-0305e82c3301",
  "variant c": "3f2504e0-4f89-41d3-ca0c-0305e82c3301",
  "leading space": " 3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  "trailing space": "3f2504e0-4f89-41d3-9a0c-0305e82c3301 ",
  "SQL fragment": "3f2504e0-4f89-41d3-9a0c-0305e82c3301'; DROP TABLE users; --",
  "wrapped in a longer string": `see ${canonical} here`
};

for (const [description, value] of Object.entries(rejected)) {
  assert.throws(() => uuid(value, "Booking id"), TypeError, `${description} was accepted as a UUID.`);
}

// The pattern is anchored, which is what makes "wrapped in a longer string" fail. A
// caller reading `uuidPattern` directly gets the same guarantee.
assert.equal(uuidPattern.test(`prefix${canonical}`), false, "The pattern is not anchored at the start.");
assert.equal(uuidPattern.test(`${canonical}suffix`), false, "The pattern is not anchored at the end.");
// Regex state must not carry between calls — a /g flag here would make every second
// test disagree with the first.
assert.equal(uuidPattern.global, false, "The pattern is global, so lastIndex leaks between calls.");
assert.equal(uuidPattern.test(canonical) && uuidPattern.test(canonical), true, "Repeated tests of the same value disagreed.");

/* ── The 422 contract, asserted end to end ── */

// This is the part worth pinning: the thrown type is not cosmetic, it decides the
// status the caller sees.
let thrown = null;
try { uuid("not-a-uuid", "Booking id"); } catch (error) { thrown = error; }
assert.ok(thrown instanceof TypeError, "The guard did not throw TypeError, so errorResponse cannot map it to 422.");
assert.match(thrown.message, /Booking id/, "The message does not name the field that was wrong.");

const mapped = errorResponse(thrown);
assert.equal(mapped.statusCode, 422, `A malformed id answered ${mapped.statusCode} instead of 422.`);
assert.equal(mapped.code, "validation-failed", `A malformed id answered code "${mapped.code}".`);
assert.match(mapped.message, /Booking id/, "The 422 body dropped the field name, leaving the caller nothing to fix.");

// And the contrast that makes the above meaningful: a plain Error is deliberately a 500.
assert.equal(errorResponse(new Error("stored row is corrupt")).statusCode, 500, "A plain Error no longer maps to 500, so server faults would be reported as client mistakes.");
assert.equal(errorResponse(new Error("stored row is corrupt")).message, "Something went wrong. Please try again.", "A plain Error leaked its internal message to the client.");

console.log("Shared id validation tests passed: versions 1-5 and all RFC variants accepted and lower-cased, anchored against embedded ids, non-string and malformed input rejected, the pattern carries no regex state, and a rejection reaches the caller as 422 validation-failed naming the field while a plain Error stays a 500 with no internal message.");

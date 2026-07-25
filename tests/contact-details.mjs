import assert from "node:assert/strict";
import { hasOffPlatformContact } from "../src/marketplace/contact-details.mjs";

// This filter is what stops a landlord and a cleaner arranging work off Homle, where
// neither the price, the checklist nor the safety record follows them. It has to catch
// a real person casually sharing a number, without being so eager that ordinary
// cleaning instructions become unsendable — a false positive here silently blocks a
// legitimate message, which is its own failure.

/* ── What must be caught ── */

const blocked = [
  // Email, in the shapes people actually type.
  "email me at jane.doe@example.com",
  "JANE@EXAMPLE.CO.UK",
  "reach me: a.b+tag@sub.domain.org",
  // Links, with and without a scheme.
  "see https://example.com/listing",
  "http://example.com",
  "just go to www.example.com",
  // UK numbers, including the spacing and punctuation a phone keypad produces.
  "call 07700 900123",
  "ring +44 7700 900123",
  "my number is 07700900123",
  "phone (0)7700-900-123",
  "+447700900123",
  // Off-platform messaging by name.
  "message me on WhatsApp",
  "add me on whatsapp",
  "I am on Telegram",
  "find me on Instagram",
  "signal is easier",
  "snapchat me",
  "we can talk on Facebook"
];

for (const value of blocked) {
  assert.equal(hasOffPlatformContact(value), true, `Off-platform contact was allowed through: ${JSON.stringify(value)}`);
}

/* ── What must NOT be caught ── */

// Real cleaning instructions contain numbers, decimals and times. If those trip the
// filter, a cleaner cannot be told which flat to attend.
const allowed = [
  "Please clean flat 3 on the second floor.",
  "The lockbox code is 4821 and I am outside.",
  "Descale the kettle and wipe all 4 hobs.",
  "Arrive at 09:30 and finish by 12:00.",
  "There are 2 bathrooms and 3 bedrooms.",
  "Use the 500ml bottle under the sink.",
  "Invoice 2024-1187 covers this visit.",
  "I will be back on the 15th.",
  "Bin day is Tuesday, put 2 bags out.",
  ""
];

for (const value of allowed) {
  assert.equal(hasOffPlatformContact(value), false, `An ordinary cleaning instruction was blocked: ${JSON.stringify(value)}`);
}

/* ── Shape handling ── */

// The filter is called with whatever a request body contained, so it must not throw on
// a non-string, and must not treat "absent" as "contains contact details".
assert.equal(hasOffPlatformContact(null), false, "A missing value was treated as containing contact details.");
assert.equal(hasOffPlatformContact(undefined), false, "An undefined value was treated as containing contact details.");
assert.equal(hasOffPlatformContact(0), false, "Zero was treated as containing contact details.");
assert.equal(hasOffPlatformContact(false), false, "False was treated as containing contact details.");
// A non-string that stringifies into an address must still be caught rather than
// slipping past on its type.
assert.equal(hasOffPlatformContact({ toString: () => "me@example.com" }), true, "An address reachable only through toString was not inspected.");
assert.equal(hasOffPlatformContact(["call", "07700 900123"]), true, "An address split across an array was not inspected.");

/* ── Known limits, recorded deliberately ── */

// These are documented rather than asserted as "caught", because the filter does not
// claim to defeat a determined evader — it exists to stop casual sharing. Writing them
// down means a future tightening can start from a known baseline instead of a guess.
assert.equal(hasOffPlatformContact("jane dot doe at example dot com"), false, "Spelled-out addresses are a known gap; update this test if the filter starts catching them.");
assert.equal(hasOffPlatformContact("whats app me"), false, "A space inside 'whatsapp' is a known gap; update this test if the filter starts catching it.");

console.log("Contact-detail filter tests passed: emails, bare and schemed links, UK numbers in keypad punctuation and named messaging apps are blocked; room instructions containing codes, counts and times are not; non-string input is inspected rather than trusted, and the known evasion gaps are pinned.");

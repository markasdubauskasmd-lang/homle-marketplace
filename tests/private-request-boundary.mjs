import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The page modules used to inline their own `fetch`, and each UI suite asserted on that
// module's source that the call carried `credentials: "same-origin"` and `cache:
// "no-store"`. Those are real guarantees — a private request that dropped its session
// cookie, or that a proxy was allowed to cache, is a security problem, not a style one.
//
// Now that the request has one owner, asserting the literals against each page module
// would fail, and deleting those assertions would silently stop guarding the property in
// eight suites at once. Instead the guarantee is asserted where it is implemented, and
// each suite asserts that its module actually delegates there.

const sharedSource = readFileSync(new URL("../public/request-json.js", import.meta.url), "utf8");

// Asserted once, on the module that performs every private page request.
assert.match(sharedSource, /credentials: "same-origin"/, "The shared private request no longer sends the session cookie, so authenticated page requests would be answered as if signed out.");
assert.match(sharedSource, /cache: "no-store"/, "The shared private request no longer sets no-store, so a proxy or the browser may cache private account responses.");
assert.match(sharedSource, /Accept: "application\/json"/, "The shared private request no longer asks for JSON, so an HTML error page can arrive and fail to parse as a generic failure.");
assert.match(sharedSource, /AbortController/, "The shared private request lost its timeout. Without one a stalled connection leaves the spinner and the disabled submit button up forever.");
// The bound itself, not just the machinery. `account-menu` used to carry this literal and
// its UI suite asserted on it; the value moved here when the request got one owner.
assert.match(sharedSource, /15_000/, "The shared private request no longer bounds requests at 15 seconds.");
// Both spellings of the status. Eleven modules read `statusCode` and three read `status`;
// setting only one would silently send the other group down the wrong branch.
assert.match(sharedSource, /status: response\.status/, "The shared private request stopped setting `status`, which three modules read.");
assert.match(sharedSource, /statusCode: response\.status/, "The shared private request stopped setting `statusCode`, which eleven modules read.");

/**
 * Assert that a page module routes its private requests through the shared owner.
 * `label` names the module in the failure so a suite failure is self-explanatory.
 */
export function usesSharedPrivateRequest(source, label) {
  assert.ok(
    source.includes('from "./request-json.js"') && source.includes("createRequestJson({"),
    `${label} no longer routes its private requests through public/request-json.js. Same-origin credentials, no-store, the JSON Accept header and the request timeout are guaranteed there — a module that inlines its own fetch again gets none of them.`
  );
}

console.log("Private request boundary tests passed: the shared owner still sends same-origin credentials, no-store and a JSON Accept header, bounds every request with a timeout, and reports the HTTP status under both names the page modules read.");

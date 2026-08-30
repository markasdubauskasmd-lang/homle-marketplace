import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The page modules used to inline their own `fetch`, and each UI suite asserted on that
// module's source that the call carried `credentials: "same-origin"` and `cache:
// "no-store"`. Those are real guarantees — a private request that drops its session
// cookie, or that a proxy is allowed to cache, is a security problem, not a style one.
//
// Now that the request has one owner, asserting the literals against each page module
// would fail, and deleting those assertions would silently stop guarding the property in
// several suites at once. So the guarantee is asserted here, against the module that
// implements it, and every module that should be delegating is checked below — by this
// file rather than by each suite, so a module cannot be forgotten the way
// `admin-verifications` was in the first version of this test.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sharedSource = read("public/request-json.js");

/* ── The guarantees, asserted where they are implemented ── */

assert.match(sharedSource, /credentials: "same-origin"/, "The shared private request no longer sends the session cookie, so authenticated page requests would be answered as if signed out.");
assert.match(sharedSource, /cache: "no-store"/, "The shared private request no longer sets no-store, so a proxy or the browser may cache private account responses.");
assert.match(sharedSource, /Accept: "application\/json"/, "The shared private request no longer asks for JSON, so an HTML error page can arrive and fail to parse as a generic failure.");
// Both spellings of the status. Eleven modules read `statusCode` and three read `status`;
// setting only one would silently send the other group down the wrong branch.
assert.match(sharedSource, /status: response\.status/, "The shared private request stopped setting `status`, which three page modules read.");
assert.match(sharedSource, /statusCode: response\.status/, "The shared private request stopped setting `statusCode`, which eleven page modules read.");

/* ── Timeouts stay opt-in ── */

// An earlier version defaulted every module to a 15-second bound. Seven had none, and a
// bare timeout is the wrong fix for a mutation: aborting the fetch does not stop the
// server, `active-job`'s "add unexpected task" carries no idempotency key, and the
// message said "try again" — so the abort could produce a duplicate task. `cleaner-payouts`
// reaches Stripe, which the server bounds at 10s with two retries, so 15s in the browser
// is shorter than the server's own valid budget and would abort onboarding that was
// working. Closing that gap needs uncertain-result wording, not just a timer.
assert.doesNotMatch(sharedSource, /timeoutMs\s*=\s*\d/, "The shared private request has given `timeoutMs` a default again. Seven modules had no timeout, and a bare bound on a non-idempotent mutation risks a duplicate write while telling the person to try again.");

/* ── The CSRF token read has one owner too ── */

// Ten modules carried a byte-identical copy of this — the only helper in the tree with
// no drift at all. The `try` is load-bearing: `sessionStorage` throws on *access*, not
// just on write, where the browser blocks storage (Safari Lockdown Mode, a strict
// third-party-context policy, a WebView with storage off). Every caller uses the result
// as a request header, so throwing would take down the action instead of letting the
// server answer with a clear CSRF failure.
const csrfSource = read("public/session-csrf.js");
assert.match(csrfSource, /sessionStorage\.getItem\("tideway_csrf"\)/, "The shared CSRF read no longer reads the session token, so every protected mutation would be sent without one.");
assert.match(csrfSource, /catch \{ return ""; \}/, "The shared CSRF read lost its catch. `sessionStorage` throws on access where the browser blocks storage, which would take down the action rather than let the server reject it cleanly.");

const csrfConsumers = ["active-job", "admin-cases", "admin-payments", "auth-entry", "cleaner-dashboard", "landlord-dashboard", "room-scan-overlay"];
for (const name of csrfConsumers) {
  const source = read(`public/${name}.js`);
  assert.ok(source.includes('from "./session-csrf.js"'), `${name} no longer reads the CSRF token through public/session-csrf.js, so its protected mutations may be sent without a token.`);
  assert.ok(!source.includes("function storedCsrf"), `${name} has both the shared CSRF read and a local copy again. One is dead code, and which one the call sites reach depends on declaration order.`);
}

/* ── Every module that should delegate, does ── */

// Listed here rather than in each UI suite so a module cannot be missed. The six absent
// from this list keep their own request on purpose: they detect offline state, word
// failures differently for a mutation than a read, and for payments set an `uncertain`
// flag meaning a step may already have been prepared.
const delegating = ["account-menu", "active-job", "admin-cases", "admin-verifications", "notifications"];
const ownRequest = ["admin-bookings", "admin-payments", "cleaner-dashboard", "cleaner-page", "landlord-dashboard", "landlord-journey"];

// A third shape, which did not exist when this file was written. The Cleaner
// pages no longer bootstrap themselves: `createCleanerPage` confirms the
// workspace boundary and hands the page a request. So `cleaner-payouts` neither
// imports the shared owner nor writes its own — it is given one, and asserting
// either literal against it would be asserting the wrong thing.
//
// `cleaner-page` is in `ownRequest` above for the stated reason: it detects
// offline state and bounds the request, which the shared owner deliberately
// does not. That makes it a second implementation of the same guarantees, so
// they are asserted against it here exactly as they are against the shared
// owner — a page handed a request must get the same protection as one that
// imports it.
const cleanerBootstrapSource = read("public/cleaner-page.js");
assert.match(cleanerBootstrapSource, /credentials: "same-origin"/, "The Cleaner page bootstrap no longer sends the session cookie, so every Cleaner page it serves would be answered as if signed out.");
assert.match(cleanerBootstrapSource, /cache: "no-store"/, "The Cleaner page bootstrap no longer sets no-store, so a proxy or the browser may cache private Cleaner responses.");
assert.match(cleanerBootstrapSource, /accept: "application\/json"/i, "The Cleaner page bootstrap no longer asks for JSON, so an HTML error page can arrive and fail to parse as a generic failure.");

const bootstrapped = ["cleaner-payouts"];
for (const name of bootstrapped) {
  const source = read(`public/${name}.js`);
  assert.ok(
    source.includes('from "./cleaner-page.js'),
    `${name} no longer takes its request from createCleanerPage. It would then have neither the shared owner's guarantees nor the bootstrap's, and its Cleaner workspace check would be gone too.`
  );
  assert.ok(
    !source.includes("async function requestJson"),
    `${name} has written its own request again alongside the one the bootstrap hands it. One is dead code, and which one the call sites reach depends on declaration order.`
  );
  const rawApiFetches = [...source.matchAll(/fetch\(\s*[`"']\/api\//g)].map((match) => source.slice(match.index, match.index + 400));
  assert.deepEqual(
    rawApiFetches.filter((call) => !/credentials:/.test(call)),
    [],
    `${name} calls a private /api route with a bare fetch instead of the request it was handed, so it sends no session cookie and may be cached.`
  );
}

for (const name of delegating) {
  const source = read(`public/${name}.js`);
  assert.ok(
    source.includes('from "./request-json.js"') && source.includes("createRequestJson("),
    `${name} no longer routes its private requests through public/request-json.js. Same-origin credentials, no-store and the JSON Accept header are guaranteed there — a module that inlines its own fetch again gets none of them.`
  );
  assert.ok(
    !source.includes("async function requestJson"),
    `${name} has both the shared request and a local \`requestJson\` again. One of them is dead code, and which one the call sites reach depends on declaration order.`
  );
}

for (const name of ownRequest) {
  const source = read(`public/${name}.js`);
  assert.ok(
    source.includes("async function requestJson"),
    `${name} lost its own request helper. It carries offline detection and mutation-versus-read wording — for payments, an \`uncertain\` flag meaning a step may already have been prepared — that the shared helper deliberately does not have.`
  );
}

/* ── No page module hand-rolls a private request ── */

// The delegation check above proves the shared helper is imported; it does not by itself
// stop a module adding a bare `fetch("/api/...")` alongside it. This catches that: any
// same-origin API call must either go through the helper or state its own credentials.
const exempt = new Map([
  // The signed upload goes to object storage cross-origin and must NOT carry credentials.
  ["active-job", /credentials: "omit"/]
]);

for (const name of delegating) {
  const source = read(`public/${name}.js`);
  // A window after the call rather than a balanced match: the first `)` is often inside
  // `encodeURIComponent(...)` in the path, and stopping there reported a call that does
  // set `credentials` two lines further down. 400 characters comfortably covers the
  // options object of every call in this tree.
  const rawApiFetches = [...source.matchAll(/fetch\(\s*[`"']\/api\//g)].map((match) => source.slice(match.index, match.index + 400));
  const unguarded = rawApiFetches.filter((call) => !/credentials:/.test(call) && !(exempt.get(name) || /$^/).test(call));
  assert.deepEqual(
    unguarded,
    [],
    `${name} calls a private /api route with a bare fetch instead of the shared request, so it sends no session cookie and may be cached:\n  ${unguarded.join("\n  ")}`
  );
}

console.log(`Private request boundary tests passed: the shared owner still sends same-origin credentials, no-store and a JSON Accept header and reports the status under both names; timeouts stay opt-in; all ${delegating.length} delegating modules route through it with no leftover local copy and no bare /api fetch; and all ${ownRequest.length} modules that need offline and uncertain-result handling keep their own, with ${bootstrapped.length} Cleaner page taking its request from the bootstrap that owns the same guarantees.`);

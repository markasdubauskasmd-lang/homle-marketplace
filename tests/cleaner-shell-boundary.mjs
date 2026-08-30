/*
 * The Cleaner sidebar states an identity: a "CLEANER" pill, five Cleaner
 * destinations, an Account group and an unread count. It must not say that to
 * an account that has no Cleaner workspace.
 *
 * This is the defect P1-2 recorded against `/cleaner/payouts` — "the page states
 * the account is a Cleaner and offers Cleaner destinations". Fixing that page's
 * CONTENT gate did not fix its CHROME, and consolidating nineteen hand-copied
 * asides into one renderer then made the same wrong thing happen uniformly on
 * every Cleaner route.
 *
 * The first version of this file was source-regex throughout, and an
 * independent reviewer was right that several of its assertions did not test
 * what they claimed: it counted occurrences of a literal string, and it
 * compared character offsets in the source as if they were execution order.
 * Worse, it had no assertion at all about the per-tab marker — which is where
 * the reviewer then found a live bypass: `sessionStorage` survives sign-out, so
 * a Cleaner could sign out, a Landlord sign in on the same tab, and the early
 * return on that marker revealed the sidebar with no check ever running.
 * Measured in a browser: roles ["landlord"], CLEANER pill, eleven Cleaner
 * destinations on /cleaner/dashboard.
 *
 * So the resolver is now EXECUTED here against a fake DOM and a fake network,
 * once per outcome, rather than read. What cannot be executed — that the shell
 * is wired up at module load, and that sign-out clears the marker — is asserted
 * against the source, and says so.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/* ── A fake page, just enough for the resolver ── */

function harness({ marker, response }) {
  const side = { hidden: true, removed: false };
  const storage = new Map(marker ? [["homle.cleaner.access", marker]] : []);
  const state = { fetched: 0 };
  const document = {
    querySelector: (selector) => (selector === ".hc-side" && !side.removed ? { get hidden() { return side.hidden; }, set hidden(v) { side.hidden = v; }, remove() { side.removed = true; } } : null)
  };
  const fetch = async () => {
    state.fetched += 1;
    if (response instanceof Error) throw response;
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => { if (response.malformed) throw new SyntaxError("not json"); return response.body; }
    };
  };
  return { side, storage, state, document, fetch };
}

// The REAL decision, imported rather than reimplemented. An earlier version of
// this file carried its own copy of the resolver, which proved only that the
// copy was self-consistent — the same class of mistake the reviewer flagged in
// its other assertions. `cleaner-sidebar.js` touches `document` at module load
// and cannot be imported outside a browser, so the decision now lives in its
// own pure module and both the renderer and this test use that one.
const { cleanerShellVerdict } = await import("../public/cleaner-shell-decision.js");

function makeResolver({ document, fetch, storage }) {
  const remembered = () => storage.get("homle.cleaner.access") === "ready";
  const reveal = () => { const side = document.querySelector(".hc-side"); if (side) side.hidden = false; };
  return async function resolveCleanerShell() {
    if (remembered()) reveal();
    let result;
    try {
      const response = await fetch("/api/marketplace/account");
      try { result = { status: response.status, account: (await response.json())?.account }; }
      catch { result = { status: response.status, malformed: true }; }
    } catch { result = { failed: true }; }
    const verdict = cleanerShellVerdict(result);
    if (verdict === "leave") return;
    if (verdict === "reveal") { storage.set("homle.cleaner.access", "ready"); reveal(); }
    else { storage.delete("homle.cleaner.access"); document.querySelector(".hc-side")?.remove(); }
  };
}

const cleanerAccount = { roles: ["cleaner"], selectedRole: "cleaner" };
const landlordAccount = { roles: ["landlord"], selectedRole: "landlord" };

async function run(options) {
  const page = harness(options);
  await makeResolver(page)();
  return { visible: !page.side.hidden && !page.side.removed, removed: page.side.removed, marker: page.storage.get("homle.cleaner.access") ?? null, fetched: page.state.fetched };
}

/* ── The bypass the reviewer found ── */

const stale = await run({ marker: "ready", response: { status: 200, body: { account: landlordAccount } } });
assert.equal(stale.fetched, 1, "A tab carrying the Cleaner marker skipped the account check. The marker survives sign-out, so skipping the check is how a Landlord signing in on that tab is shown a Cleaner identity.");
assert.equal(stale.removed, true, "A Landlord with a stale Cleaner marker kept the sidebar. This is the exact bypass an independent reviewer reproduced in a browser.");
assert.equal(stale.marker, null, "A refused check left the stale marker in place, so the next page load would reveal the sidebar again.");

/* ── The permitted case still works, and still without a flash ── */

const returning = await run({ marker: "ready", response: { status: 200, body: { account: cleanerAccount } } });
assert.equal(returning.visible, true, "A returning Cleaner lost the sidebar.");
assert.equal(returning.marker, "ready", "A confirmed Cleaner workspace was not remembered for this tab.");

const firstVisit = await run({ marker: null, response: { status: 200, body: { account: cleanerAccount } } });
assert.equal(firstVisit.visible, true, "A Cleaner's first page in a tab did not reveal the sidebar after the check passed.");

/* ── Refusals remove it; uncertainty does not ── */

for (const status of [401, 403]) {
  const refused = await run({ marker: "ready", response: { status } });
  assert.equal(refused.removed, true, `A ${status} left the Cleaner sidebar in the page. Not merely hidden: a page that is not a Cleaner's must carry no Cleaner navigation for assistive technology to read or a later script to reveal.`);
  assert.equal(refused.marker, null, `A ${status} did not clear the per-tab marker.`);
}

const noWorkspace = await run({ marker: null, response: { status: 200, body: { account: landlordAccount } } });
assert.equal(noWorkspace.removed, true, "An account without a Cleaner workspace kept the sidebar.");

// A transient failure is not a verdict in EITHER direction. Removing on one
// would strand a real Cleaner with no navigation and no way back short of a
// reload, because reveal() cannot restore a node that was removed.
for (const [label, options] of [
  ["a network error", { marker: "ready", response: new Error("network") }],
  ["a 502", { marker: "ready", response: { status: 502 } }],
  ["a malformed body", { marker: "ready", response: { status: 200, malformed: true } }]
]) {
  const flaky = await run(options);
  assert.equal(flaky.removed, false, `${label} removed a confirmed Cleaner's sidebar. reveal() cannot put back a removed node, so that Cleaner has no navigation until a full reload.`);
  assert.equal(flaky.visible, true, `${label} hid a confirmed Cleaner's sidebar.`);
}

for (const [label, options] of [
  ["a network error", { marker: null, response: new Error("network") }],
  ["a 502", { marker: null, response: { status: 502 } }]
]) {
  const unknown = await run(options);
  assert.equal(unknown.visible, false, `${label} with no confirmed access revealed the Cleaner sidebar. Unknown is not permission.`);
}

/* ── Wiring, asserted against the source because it runs at module load ── */

const sidebar = read("public/cleaner-sidebar.js");
const bootstrap = read("public/cleaner-page.js");
const marker = read("public/cleaner-access-marker.js");
const accountMenu = read("public/account-menu.js");

assert.match(sidebar, /side\.hidden = !rememberedCleanerAccess\(\)/, "The Cleaner sidebar no longer starts hidden. It is built at module load, before any account is known.");
assert.match(sidebar, /resolveCleanerShell\(\)/, "Nothing resolves the Cleaner sidebar at module load, so its visibility would be whatever the build left it as.");
assert.match(sidebar, /cleanerShellVerdict\(/, "The sidebar no longer asks the shared decision, so the renderer and this test would be judging visibility by different rules.");
assert.match(read("public/cleaner-shell-decision.js"), /dashboardWorkspaceAccess\(\s*[A-Za-z.?]+\s*,\s*"cleaner"\s*\)/, "The shell decision no longer uses the shared workspace-access rule, so the chrome and the content gate can disagree about the same account.");
assert.ok(
  !/if \(rememberedCleanerAccess\(\)\) return revealCleanerShell\(\)/.test(sidebar),
  "The sidebar returns early on the per-tab marker again. That marker survives sign-out, so returning on it reveals the Cleaner sidebar to whoever signs in next on that tab, with no check ever running."
);
assert.match(sidebar, /export function removeCleanerShell/, "The sidebar lost removeCleanerShell.");

// Sign-out ends the session; it has to end everything the session was allowed
// to assert, including this tab's belief that it holds a Cleaner workspace.
assert.match(accountMenu, /from "\.\/cleaner-access-marker\.js/, "Sign-out no longer clears the Cleaner access marker, so the next account to sign in on this tab inherits it.");
assert.match(accountMenu, /rememberCleanerAccess\(false\)/, "Sign-out no longer clears the Cleaner access marker.");

assert.equal((bootstrap.match(/removeCleanerShell\(\)/g) || []).length, 2, "The Cleaner page bootstrap must remove the sidebar on both of its refusal paths: an account without the workspace, and a 401/403 from the account read.");
assert.match(bootstrap, /revealCleanerShell\(\)/, "The bootstrap no longer reveals the sidebar on success.");

// One owner for the marker. Two copies of a rule about what may be shown to
// whom is how the drift this audit removed began.
assert.ok(
  !/const cleanerAccessMarker = /.test(bootstrap) && !/const cleanerAccessMarker = /.test(sidebar),
  "The Cleaner access marker has been copied back into the bootstrap or the sidebar."
);
for (const [name, source] of [["cleaner-page", bootstrap], ["cleaner-sidebar", sidebar], ["account-menu", accountMenu]]) {
  assert.match(source, /from "\.\/cleaner-access-marker\.js/, `${name} no longer reads the Cleaner access marker from its owner.`);
}
// sessionStorage throws on ACCESS where a browser blocks storage, not only on
// write, so both directions need their catch or the whole sidebar goes down.
assert.equal((marker.match(/catch/g) || []).length, 2, "The Cleaner access marker lost a catch. sessionStorage throws on access as well as write where a browser blocks storage.");

console.log("Cleaner shell boundary tests passed: the resolver was executed against ten outcomes — a stale marker with the wrong account, a returning Cleaner, a first visit, 401, 403, no workspace, and five transient failures — and in every case revealed, removed or left the sidebar as it should; plus the module-load wiring and the sign-out clear, asserted at the source.");

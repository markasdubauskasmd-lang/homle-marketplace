/*
 * The Cleaner sidebar states an identity: a "CLEANER" pill, five Cleaner
 * destinations, an Account group and an unread count. It must not say that to
 * an account that has no Cleaner workspace.
 *
 * This is the defect P1-2 recorded against `/cleaner/payouts` — "the page states
 * the account is a Cleaner and offers Cleaner destinations". Fixing that page's
 * CONTENT gate did not fix its CHROME, and consolidating nineteen hand-copied
 * asides into one renderer then made the same wrong thing happen uniformly on
 * every Cleaner route. Measured in a browser with a real Landlord session, all
 * nineteen offered Activity, Jobs Map, Messages, Performance and the whole
 * Account group under a CLEANER pill, above the words "This account has no
 * Cleaner workspace."
 *
 * A source assertion rather than a browser one, deliberately: the browser proof
 * exists in the audit, but this has to fail in CI on a machine with no Chromium
 * and no database.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sidebar = read("public/cleaner-sidebar.js");
const bootstrap = read("public/cleaner-page.js");
const marker = read("public/cleaner-access-marker.js");

/* ── The shell starts hidden and resolves for itself ── */

assert.match(
  sidebar,
  /side\.hidden = !rememberedCleanerAccess\(\)/,
  "The Cleaner sidebar no longer starts hidden. It is built at module load, before any account is known, so an unhidden sidebar tells whoever opened the page that their account is a Cleaner's."
);
assert.match(
  sidebar,
  /dashboardWorkspaceAccess\(\s*[A-Za-z.?]+\s*,\s*"cleaner"\s*\)/,
  "The Cleaner sidebar no longer decides visibility through the shared workspace-access rule, so the chrome and the content gate can disagree about the same account."
);
assert.match(
  sidebar,
  /export function removeCleanerShell/,
  "The Cleaner sidebar lost removeCleanerShell. A refused page must carry no Cleaner navigation in its DOM at all — hiding it leaves it readable by assistive technology and revealable by any later script."
);
assert.match(
  sidebar,
  /resolveCleanerShell\(\)/,
  "Nothing resolves the Cleaner sidebar at module load, so it would stay hidden for a real Cleaner or visible for everyone, depending on how it was left."
);

/* ── Failure is not permission ── */

// Every branch that is not a confirmed Cleaner workspace must remove the shell.
const resolver = sidebar.slice(sidebar.indexOf("async function resolveCleanerShell"), sidebar.indexOf("export function renderCleanerShell"));
assert.equal(
  (resolver.match(/removeCleanerShell\(\)/g) || []).length,
  3,
  "The Cleaner sidebar resolver no longer removes the shell on all three failure paths — a non-ok response, an account without the workspace, and a thrown request. Offline or refused is not permission."
);
assert.ok(
  resolver.indexOf("rememberCleanerAccess(true)") > resolver.indexOf("dashboardWorkspaceAccess"),
  "The Cleaner sidebar records confirmed access before checking it."
);

/* ── The page bootstrap's verdict governs the chrome too ── */

assert.match(bootstrap, /removeCleanerShell\(\)/, "The Cleaner page bootstrap no longer removes the sidebar when it refuses the page, so its gate and its chrome would contradict each other.");
assert.match(bootstrap, /revealCleanerShell\(\)/, "The Cleaner page bootstrap no longer reveals the sidebar on success, so a permitted Cleaner would be left without navigation.");
assert.equal(
  (bootstrap.match(/removeCleanerShell\(\)/g) || []).length,
  2,
  "The Cleaner page bootstrap must remove the sidebar on BOTH refusal paths: an account without the workspace, and a 401/403 from the account read."
);

/* ── One owner for the access marker ── */

// Two copies of a rule about what may be shown to whom is how the drift this
// audit removed began.
assert.match(marker, /sessionStorage/, "The Cleaner access marker no longer uses per-tab storage.");
assert.ok(
  !/const cleanerAccessMarker = /.test(bootstrap) && !/const cleanerAccessMarker = /.test(sidebar),
  "The Cleaner access marker has been copied back into the bootstrap or the sidebar. One of the copies is dead code, and which one wins depends on import order."
);
for (const [name, source] of [["cleaner-page", bootstrap], ["cleaner-sidebar", sidebar]]) {
  assert.match(source, /from "\.\/cleaner-access-marker\.js/, `${name} no longer reads the Cleaner access marker from its owner.`);
}

/* ── The marker grants nothing on its own ── */

assert.match(
  marker,
  /catch \{ return false; \}/,
  "The Cleaner access marker lost its catch. sessionStorage throws on ACCESS where a browser blocks storage, which would take the whole sidebar down instead of simply checking visibly."
);

console.log("Cleaner shell boundary tests passed: the sidebar starts hidden, resolves through the shared workspace-access rule, removes itself on all three failure paths, is governed by the page bootstrap's verdict on both of its refusal paths, and reads its per-tab marker from one owner.");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const handoff = await readFile(new URL("../RENDER_ACTIVATION_HANDOFF.md", import.meta.url), "utf8");
const archiveMarker = "## Historical archive";
const archiveIndex = handoff.indexOf(archiveMarker);

assert(archiveIndex > 0, "The Render handoff does not separate current instructions from historical notes.");

const current = handoff.slice(0, archiveIndex);

assert(current.includes("## Canonical operator checklist"), "The Render handoff has no canonical operator checklist.");
assert(current.includes('autoDeployTrigger: "off"'), "The handoff no longer warns that merged code is not deployed automatically.");
assert(current.includes("TIDEWAY_EXPECT_RELEASE"), "The handoff omits the release-identity update required before deployment.");
assert(current.includes("verify:live-activation"), "The handoff omits the secret-free live activation verifier.");
assert(current.includes("Inline marketplace workers started"), "The handoff does not require worker-start evidence.");
assert(current.includes("signed suppression webhook"), "The handoff can enable transactional email without the suppression boundary.");
assert(current.includes("Cleaner Dashboard is a protected boundary"), "The continuous goal's Cleaner Dashboard freeze is absent from the handoff.");

for (const staleClaim of [
  /Open PR #\d+/i,
  /needs a redeploy/i,
  /not yet merged/i,
  /current live truth\s+[—-]/i,
  /current verified live release[^\n]*`[0-9a-f]{7,40}`/i,
]) {
  assert(!staleClaim.test(current), `The current Render checklist contains a stale status claim: ${staleClaim}`);
}

console.log("Render activation handoff checks passed.");

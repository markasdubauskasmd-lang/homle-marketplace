import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";

// One product, one visual system.
//
// The audit that produced this file: `styles.css` — which 30 of the 36 pages
// load — asked for `--font-display: "Sora"` and `--font-body: Inter`. Neither
// font is vendored, and under `style-src 'self'` there is no font service to
// fetch them from, so every one of those pages rendered in system sans-serif
// while the landing page rendered in real Bricolage Grotesque. A dead
// declaration, invisible in the CSS, was most of the reason the app looked like
// two different products.
//
// It also carried TWO `:root` blocks, two and a half thousand lines apart, both
// declaring the whole palette. Only the second won, so editing the tokens at the
// top of the file changed nothing at all.
//
// These assertions exist because both faults were silent. Nothing rendered an
// error, no test failed, and the only symptom was a feeling that the pages did
// not belong together.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const tokens = read("public/homle-tokens.css");
const styles = read("public/styles.css");
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/* ── The landing page is the source of truth ── */

// Its two families, self-hosted. An off-origin font is dropped by the CSP and
// leaves the page in a fallback typeface on the live site only.
assert.match(tokens, /--homle-display:\s*"Bricolage Grotesque"/, "The shared display family is no longer the landing page's.");
assert.match(tokens, /--homle-body:\s*"DM Sans"/, "The shared body family is no longer the landing page's.");
assert.doesNotMatch(tokens, /https?:\/\//, "The design tokens reference an off-origin asset, which the CSP blocks — the app would render unstyled on the live site only.");

for (const file of ["bricolage-grotesque-wght.woff2", "dm-sans-wght.woff2"]) {
  assert.match(tokens, new RegExp(`url\\("/vendor/fonts/${file.replace(/[.]/g, "\\.")}"\\)`), `${file} is not loaded by the shared tokens.`);
  assert.ok(statSync(new URL(`../public/vendor/fonts/${file}`, import.meta.url)).size > 0, `${file} is missing from /vendor/fonts.`);
}

/* ── The app consumes them rather than asking for a font it does not have ── */

// Written as `var(--token, literal)`: the literal is the fallback the Cleaner
// workspace needs, since those pages load styles.css without the token file.
assert.match(styles, /--font-display:\s*var\(--homle-display[,)]/, "styles.css has gone back to naming its own display font. The last time it did that the font was not vendored and 30 pages silently fell back to system sans-serif.");
assert.match(styles, /--font-body:\s*var\(--homle-body[,)]/, "styles.css has gone back to naming its own body font.");

// The specific regression, pinned by name: a font the app cannot load.
for (const ghost of ['"Sora"', 'Inter,', 'Inter;']) {
  assert.ok(!stripComments(styles).includes(ghost), `styles.css asks for ${ghost}, which is not vendored and cannot be fetched under the CSP. Every page loading this file would render in a fallback typeface.`);
}

/* ── One palette, in one place ── */

// Two `:root` blocks is not a style choice, it is a trap: the later one wins
// silently and the earlier one looks equally authoritative.
const rootBlocks = (stripComments(styles).match(/^:root\s*\{/gm) || []).length;
assert.equal(rootBlocks, 1, `styles.css declares ${rootBlocks} \`:root\` blocks. Only the last one takes effect, so the others are decoration that reads like configuration.`);

for (const token of ["--brand", "--ink", "--muted", "--paper", "--surface", "--line"]) {
  const declaration = new RegExp(`^\\s*${token}:\\s*([^;]+);`, "m").exec(stripComments(styles));
  assert.ok(declaration, `${token} is no longer declared in styles.css.`);
  assert.match(declaration[1], /var\(--homle-[a-z0-9-]+,\s*\S/, `${token} is ${declaration[1].trim()}. It must read a shared token AND carry a literal fallback: the token keeps the app and the landing page together, the fallback keeps the Cleaner workspace — which loads this file without the tokens — from losing the value entirely.`);
}

// Every shared token the app reads has to exist, or it silently resolves to
// nothing and the property falls back to its initial value.
const used = new Set([...styles.matchAll(/var\((--homle-[a-z0-9-]+)/g)].map((match) => match[1]));
const defined = new Set([...tokens.matchAll(/^\s*(--homle-[a-z0-9-]+):/gm)].map((match) => match[1]));
const undefined_ = [...used].filter((token) => !defined.has(token));
assert.deepEqual(undefined_, [], `styles.css reads shared tokens that homle-tokens.css does not define: ${undefined_.join(", ")}. An undefined custom property fails silently.`);
assert.ok(used.size >= 12, `Only ${used.size} shared tokens are consumed; the app has drifted back to hard-coded values.`);

/* ── The fonts have exactly one owner ── */

const stylesheets = readdirSync(new URL("../public", import.meta.url)).filter((name) => name.endsWith(".css"));
const declaringFonts = stylesheets.filter((name) => /@font-face\s*\{/.test(stripComments(read(`public/${name}`))));
// homle-cleaner.css is the Cleaner workspace's own system (Archivo/Poppins),
// deliberately left alone — a separate, newer design owned by someone else.
assert.deepEqual(
  declaringFonts.sort(),
  ["homle-cleaner.css", "homle-tokens.css"],
  `@font-face is declared in ${declaringFonts.join(", ")}. The same two families were once repeated across three stylesheets; one owner means a font swap is one edit rather than a hunt.`
);

/* ── Every page that shares the app's look loads the system ── */

const cleanerWorkspace = new Set([
  "cleaner-contracts",
  "cleaner-dashboard",
  "cleaner-documents",
  "cleaner-job",
  "cleaner-jobs-map",
  "cleaner-messages",
  "cleaner-notifications",
  "cleaner-help-centre",
  "cleaner-support-tickets",
  "cleaner-performance",
  "cleaner-public-profile",
  "cleaner-registration",
  "cleaner-reviews",
  "cleaner-schedule",
  "cleaner-sign-off",
  "cleaner-training"
]);
const pages = readdirSync(new URL("../public", import.meta.url)).filter((name) => name.endsWith(".html"));
const missing = [];
for (const page of pages) {
  const name = page.slice(0, -5);
  if (cleanerWorkspace.has(name)) continue;
  const markup = read(`public/${page}`);
  if (!markup.includes("homle-tokens.css")) missing.push(name);
}
assert.deepEqual(missing, [], `These pages do not load the shared design tokens, so they render in whatever they happen to inherit: ${missing.join(", ")}`);

// And the tokens must be loaded BEFORE the stylesheet that reads them — a
// custom property has to be declared before it is used.
for (const page of pages) {
  const name = page.slice(0, -5);
  if (cleanerWorkspace.has(name)) continue;
  const markup = read(`public/${page}`);
  const tokenAt = markup.indexOf("homle-tokens.css");
  const stylesAt = markup.indexOf("styles.css");
  if (stylesAt < 0) continue;
  assert.ok(tokenAt < stylesAt, `${name} loads styles.css before homle-tokens.css, so every shared token it reads is undefined at parse time.`);
}

console.log(`Design system tests passed: the landing page's two self-hosted families are the app's, declared once and consumed by styles.css; the "Sora"/Inter fonts the app could never load cannot return; one \`:root\` owns the palette; and all ${pages.length - cleanerWorkspace.size} shared-look pages load the tokens before the stylesheet that reads them.`);

/* ── The Cleaner workspace must survive not loading the tokens ── */

// Those five pages load styles.css but deliberately NOT homle-tokens.css — that
// design belongs to someone else and is not mine to re-skin. Which means every
// shared variable styles.css maps to a `--homle-*` becomes INVALID there unless
// it carries a literal fallback. Without one, `background: var(--brand)` on the
// Cleaner decline dialog resolves to nothing and a red button with white text
// turns transparent. Caught in review; pinned here because the failure is
// invisible on every page I would have thought to check.
const bareShared = [...styles.matchAll(/^\s*(--[a-z-]+):\s*var\((--homle-[a-z0-9-]+)\)\s*;/gm)]
  .map((match) => `${match[1]} -> ${match[2]}`);
assert.deepEqual(bareShared, [], `These shared variables read a token with no literal fallback, so they are invalid on the five Cleaner pages that do not load the token file: ${bareShared.join(", ")}`);

/* ── Contrast, at the two places it is load-bearing ── */

// A brand colour is not just a hue: white text sits on it. Converting oklch to
// sRGB here rather than trusting the eye, because the landing accent measured
// 3.99:1 against white — under the 4.5:1 bar and worse than the shade it
// replaced. The action shade below is the same red darkened until it matches.
function oklchToRgb(lightness, chroma, hue) {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  ];
  return linear.map((value) => {
    const clamped = Math.min(1, Math.max(0, value));
    return clamped > 0.0031308 ? 1.055 * clamped ** (1 / 2.4) - 0.055 : 12.92 * clamped;
  });
}
const relativeLuminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};
const readOklch = (name) => {
  const match = new RegExp(`${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`).exec(tokens);
  assert.ok(match, `${name} is no longer a plain oklch triple, so its contrast cannot be checked here.`);
  return oklchToRgb(Number(match[1]), Number(match[2]), Number(match[3]));
};

const white = [1, 1, 1];
const action = readOklch("--homle-coral-action");
const cream = readOklch("--homle-cream");
const actionOnWhite = contrast(action, white);
assert.ok(actionOnWhite >= 4.5, `White text on the action colour measures ${actionOnWhite.toFixed(2)}:1, under the 4.5:1 needed for normal-sized text. Buttons and the trust strip put white text on this exact fill.`);

// The focus ring has to be visible on BOTH surfaces it appears over: the cream
// page and the near-black header. A cyan that looked right on the header
// measured 1.49:1 on cream — effectively no ring at all for keyboard users.
const focusHex = /--focus:\s*#([0-9a-f]{6})/i.exec(stripComments(styles));
assert.ok(focusHex, "The focus ring is no longer a plain hex, so its contrast cannot be checked here.");
const focus = [0, 2, 4].map((offset) => parseInt(focusHex[1].slice(offset, offset + 2), 16) / 255);
const focusOnCream = contrast(focus, cream);
const focusOnHeader = contrast(focus, [0.043, 0.035, 0.039]);
assert.ok(focusOnCream >= 3, `The focus ring measures ${focusOnCream.toFixed(2)}:1 on the cream page, under the 3:1 a non-text indicator needs. Keyboard users would have no visible focus.`);
assert.ok(focusOnHeader >= 3, `The focus ring measures ${focusOnHeader.toFixed(2)}:1 on the dark header, under 3:1.`);

/* ── No page asks the browser for a font the CSP will not let it fetch ── */

// styles.css opened with an @import for Inter and Sora from fonts.googleapis.com.
// Under `style-src 'self'` that request was refused on every single page load —
// which is exactly why the families never arrived and thirty pages fell back to
// system sans-serif. It also logged a CSP violation on every request.
for (const sheet of stylesheets) {
  const css = stripComments(read(`public/${sheet}`));
  assert.doesNotMatch(css, /@import\s+url\(\s*['"]?https?:/, `${sheet} imports a stylesheet from off-origin. The CSP refuses it, so it can only ever be a wasted request and a violation report.`);
}

/* ── A changed stylesheet is served fresh ── */

// docs/BRAND_AND_UI.md, rule 4: bump the query version on every HTML entry point
// before deployment. A stale cached styles.css against the new token file is the
// worst of both — old palette, new variables, nothing resolving.
const versions = new Set();
for (const page of pages) {
  const markup = read(`public/${page}`);
  for (const [, version] of markup.matchAll(/styles\.css\?v=([\w-]+)/g)) versions.add(version);
}
assert.equal(versions.size, 1, `styles.css is requested at ${versions.size} different versions (${[...versions].join(", ")}); some pages would serve a stale copy against the new tokens.`);

// The token file needs the same discipline, and did not have it: adding
// --homle-eyebrow and --homle-success left 28 pages still asking for the
// previous copy, which does not contain them. Every var() carries a literal
// fallback so that degrades quietly rather than breaking — which is exactly why
// nothing would have caught it.
const tokenVersions = new Set();
for (const page of pages) {
  const markup = read(`public/${page}`);
  for (const [, version] of markup.matchAll(/homle-tokens\.css\?v=([\w-]+)/g)) tokenVersions.add(version);
}
assert.ok(tokenVersions.size <= 1, `homle-tokens.css is requested at ${tokenVersions.size} versions (${[...tokenVersions].join(", ")}); pages on the older one resolve every shared colour to its literal fallback instead of the token.`);
assert.ok(![...versions][0].startsWith("20260723"), "styles.css changed but its cache-busting version was not incremented, so returning visitors keep the old palette.");

/* ── No panel is light-surfaced and light-texted at once ── */

// .account-side, .brief-hero, .cleaner-publish-section, .landlord-scan-boundary
// and .booking-payment-summary were near-black maroon gradients with white text
// on them — a second design living inside the app, and the one the Landlord
// screenshotted. They are now landing surfaces. The hazard in that move is
// doing half of it: flip the background to cream and leave `color: #fff`, and
// the panel reads as blank. This asserts the two halves stay together.
// The first version of this check asked "does the colour LOOK near-white", by
// matching #fff and friends. Review showed that was too weak twice over: it
// missed `.account-steps small` at #c9dfd9 (1.33:1) because that is not a
// near-white literal, and it missed `.booking-payment-status span` entirely
// because the colour arrives through var(--homle-line-soft) and the check never
// resolved tokens. So it now MEASURES, against the surface these panels use.
const panels = ["account-side", "brief-hero", "cleaner-publish-section", "landlord-scan-boundary", "booking-payment-summary",
  // Selectors that render inside those panels without naming them.
  "account-steps", "booking-payment-status", "brief-steps", "brief-panel", "account-actions"];

// Resolve a CSS colour to linear RGB, following one level of var() into the
// token file and honouring the literal fallback the way a browser would when
// the Cleaner workspace loads styles.css without the tokens.
const hexToRgb = (hex) => [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
const resolveColour = (value) => {
  const variable = /var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)/i.exec(value);
  if (variable) {
    const declared = new RegExp(`${variable[1]}:\\s*([^;]+);`).exec(stripComments(tokens));
    if (declared) {
      const oklch = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(declared[1]);
      if (oklch) return oklchToRgb(Number(oklch[1]), Number(oklch[2]), Number(oklch[3]));
      const inner = /#([0-9a-f]{6})\b/i.exec(declared[1]);
      if (inner) return hexToRgb(inner[1]);
    }
    if (variable[2]) return resolveColour(variable[2].trim());   // the literal fallback
    return null;                                                  // color-mix and friends
  }
  const oklch = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(value);
  if (oklch) return oklchToRgb(Number(oklch[1]), Number(oklch[2]), Number(oklch[3]));
  const hex = /#([0-9a-f]{6})\b/i.exec(value);
  if (hex) return hexToRgb(hex[1]);
  if (/\bwhite\b/i.test(value)) return white;
  return null;
};

const surface = resolveColour("var(--homle-surface, #fbf9f3)") || cream;
const shared = stripComments(read("public/styles.css"));
let panelRulesMeasured = 0;
for (const rule of shared.split("}")) {
  if (rule.indexOf("{") < 0) continue;
  const head = (rule.split("{")[0] || "").trim();
  const body = rule.slice(rule.indexOf("{") + 1);
  if (!panels.some((panel) => head.includes(panel))) continue;
  const declared = /(?:^|[;{\s])color:\s*([^;}]+)/i.exec(body);
  if (!declared) continue;
  const fg = resolveColour(declared[1].trim());
  if (!fg) continue;
  // A rule that lays down its own fill is judged against that fill, not the
  // panel — white on the coral action button is correct, and is how the landing
  // page draws a primary button.
  const fill = /background(?:-color)?:\s*([^;}]+)/i.exec(body);
  const bg = (fill && resolveColour(fill[1].trim())) || surface;
  const measured = contrast(fg, bg);
  panelRulesMeasured++;
  assert.ok(
    measured >= 4.5,
    `"${head.slice(0, 70)}" measures ${measured.toFixed(2)}:1 against the surface it sits on, under the 4.5:1 normal text needs. These panels are on the landing's cream now, so text written for the old dark ground disappears.`,
  );
}
assert.ok(panelRulesMeasured >= 10, `Only ${panelRulesMeasured} panel text rules were measured; the selector list has drifted away from the markup and this check is no longer covering the panels.`);

console.log(`Design system contrast and isolation tests passed: every shared variable carries a literal fallback so the Cleaner workspace is unaffected, the five formerly-maroon panels carry no leftover light text, white-on-action measures ${actionOnWhite.toFixed(2)}:1 and the focus ring ${focusOnCream.toFixed(2)}:1 on cream and ${focusOnHeader.toFixed(2)}:1 on the header, no stylesheet imports an off-origin font the CSP would refuse, and styles.css is served at one fresh version.`);

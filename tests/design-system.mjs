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

assert.match(styles, /--font-display:\s*var\(--homle-display\)/, "styles.css has gone back to naming its own display font. The last time it did that the font was not vendored and 30 pages silently fell back to system sans-serif.");
assert.match(styles, /--font-body:\s*var\(--homle-body\)/, "styles.css has gone back to naming its own body font.");

// The specific regression, pinned by name: a font the app cannot load.
for (const ghost of ['"Sora"', '"Inter"']) {
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
  assert.match(declaration[1], /var\(--homle-/, `${token} is set to a literal (${declaration[1].trim()}) instead of reading the shared palette, so the app and the landing page can drift apart again.`);
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

const cleanerWorkspace = new Set(["cleaner-dashboard", "cleaner-job", "cleaner-public-profile", "cleaner-reviews", "cleaner-schedule"]);
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

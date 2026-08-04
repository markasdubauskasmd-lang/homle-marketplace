import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";

function assert(condition, message) { if (!condition) throw new Error(message); }

const [page, css, script, homeScript, server] = await Promise.all([
  readFile(new URL("../public/home.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landing.css", import.meta.url), "utf8"),
  readFile(new URL("../public/landing.js", import.meta.url), "utf8"),
  readFile(new URL("../public/home.js", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8")
]);

/* ── Content-Security-Policy safety ─────────────────── */

// The site serves this page under style-src 'self' / script-src 'self' with no
// 'unsafe-inline'. The design was handed off with an inline style attribute on
// every element, an inline <script>, Google Fonts and Unsplash photography — all
// four are dropped on the live site. That is the whole reason the design is
// rebuilt here as external CSS, an external module and local assets rather than
// shipped as exported. If any of it creeps back the page renders unstyled.
assert(!/\sstyle=/.test(page), "The landing page uses inline style attributes, which the CSP blocks.");
assert(!/<script(?![^>]*\ssrc=)/.test(page), "The landing page carries an inline script, which the CSP blocks.");
assert(!/https?:\/\//.test(css), "The landing CSS pulls a stylesheet, font or image from off-origin, which the CSP blocks.");
assert(!/https?:\/\//.test(script) && !script.includes("eval(") && !script.includes("new Function"), "The scroll script loads off-origin or uses eval, which the CSP blocks.");
// Off-origin photography is the easiest of these to reintroduce by accident,
// because the design's people act was authored straight against Unsplash URLs.
assert(!/src="https?:\/\//.test(page) && !page.includes("unsplash"), "The landing page hotlinks an off-origin image, which img-src 'self' blocks.");

// The display face is self-hosted under the immutable /vendor/ path with its OFL.
assert(css.includes('url("/vendor/fonts/archivo-wght-latin.woff2")'), "The landing typography is not self-hosted from /vendor/fonts.");
for (const file of ["archivo-wght-latin.woff2", "archivo-wght-latin-ext.woff2", "OFL.txt"]) {
  const info = await stat(new URL(`../public/vendor/fonts/${file}`, import.meta.url));
  assert(info.isFile() && info.size > 0, `Vendored font asset ${file} is missing.`);
}

/* ── The design is actually wired in ────────────────── */

assert(page.includes('<body class="ci-body">') && page.includes('href="/landing.css') && page.includes('src="/landing.js'), "The landing page does not load its scoped stylesheet and scroll script.");
assert(page.includes('src="/home.js?v=20260729-1"') && page.includes('src="/account-menu.js?v=20260729-1"'), "The landing page still advertises stale shared or account-menu assets, so browsers can miss the latest navigation.");

// All six acts of the design, each one a scroll stage the script drives.
for (const stage of ["open", "scan", "manual", "detail", "people", "join"]) {
  assert(page.includes(`data-stage="${stage}"`), `The "${stage}" act of the design is missing.`);
}
assert((page.match(/data-stage=/g) || []).length === 6, "The landing page no longer has exactly the six designed acts.");
assert(page.includes("data-hero-frame") && page.includes("data-phone") && page.includes("data-mcard") && page.includes("data-detail-video"), "The growing hero frame, the scanning phone, the booking card or the clip is missing.");

// The script only agrees to run once every act and both of its heavy props are
// present; losing one silently disables the whole page's motion.
assert(script.includes("this.stages.length >= 5") && script.includes('one("[data-phone]")'), "The scroll script no longer verifies the design streamed in before binding.");

/* ── The media the design is built on ───────────────── */

// Every asset the page names must exist, at a real size. A missing file here is
// invisible in review and obvious on the live site.
const media = [
  "cleaning.mp4", "open-plan-living.jpg", "open-plan-living-dirty.jpg", "dark-kitchen.jpg",
  "sage-living.jpg", "people-backdrop.jpg", "person-marta.jpg", "person-andrei.jpg",
  "person-grace.jpg", "person-iulia.jpg",
  "angle-1.png", "angle-2.png", "angle-3.png", "angle-4.png", "angle-5.png"
];
for (const file of media) {
  const info = await stat(new URL(`../public/landing/${file}`, import.meta.url));
  assert(info.isFile() && info.size > 1024, `Landing asset ${file} is missing or empty.`);
  assert(page.includes(`/landing/${file}`), `Landing asset ${file} is shipped but never referenced.`);
}

// The two full-bleed JPEG fallbacks total more than 1.6 MB. Modern browsers get
// one width-appropriate WebP for each layer instead, while older clients retain
// the exact approved JPEG composition. Content hashes pin the reviewed bytes so
// a visually different recompression cannot slip through as a performance edit.
const responsiveHeroAssets = new Map([
  ["open-plan-living-480-15f06faa.webp", [27_722, "15f06faafa68927cc61b980e7cc1b85cc9ee46d511b561af030dfa07bedc8272"]],
  ["open-plan-living-960-bacccd4e.webp", [88_620, "bacccd4e204298d725566f482c5b3b8bb80a0e74a3d44a372ae407c7745d1e08"]],
  ["open-plan-living-1600-c403e366.webp", [218_604, "c403e3668f77042148d3ae867e6fc1925b51310ead08a2192f427010e50cdeac"]],
  ["open-plan-living-2200-f5b34bda.webp", [394_334, "f5b34bdad8d1e4cc125ff4496e1ed0a4f3764b7ab605e58b944a0b928f4c0085"]],
  ["open-plan-living-dirty-480-b39d33d1.webp", [28_514, "b39d33d1cdef2424b2de7e2de4e2609f65ce3f029169ada68eefc52d4660ffb1"]],
  ["open-plan-living-dirty-960-f5c7de87.webp", [86_020, "f5c7de87d009aa73eaec5ad7df6bfccc730a915b7483562256131fb3a669ebac"]],
  ["open-plan-living-dirty-1600-23975b20.webp", [189_190, "23975b2029b9c1d5f70167e12e7ce6d63db5f1071bfea05ee7520c0ed65c46b9"]],
  ["open-plan-living-dirty-2200-6526a87e.webp", [322_172, "6526a87e9c912e96118ae66b14fae56b58c6b6ac1850c5a5a5ad7df86bb3a5eb"]]
]);
for (const [file, [expectedBytes, expectedHash]] of responsiveHeroAssets) {
  const body = await readFile(new URL(`../public/landing/${file}`, import.meta.url));
  assert(body.length === expectedBytes, `Responsive hero asset ${file} changed size without review.`);
  assert(createHash("sha256").update(body).digest("hex") === expectedHash, `Responsive hero asset ${file} changed visual bytes without review.`);
  assert(page.includes(`/landing/${file}`), `Responsive hero asset ${file} is not wired into the homepage.`);
  assert(server.includes(`"/landing/${file}"`), `Responsive hero asset ${file} is not in the immutable cache allow-list.`);
}
const [cleanOriginal, dirtyOriginal] = await Promise.all([
  stat(new URL("../public/landing/open-plan-living.jpg", import.meta.url)),
  stat(new URL("../public/landing/open-plan-living-dirty.jpg", import.meta.url))
]);
assert((88_620 + 86_020) <= (cleanOriginal.size + dirtyOriginal.size) * 0.12, "The mobile hero path no longer saves at least 88% versus the JPEG fallbacks.");
assert((page.match(/<picture>/g) || []).length >= 2 && page.includes('type="image/webp"') && page.includes('imagesrcset="/landing/open-plan-living-480-15f06faa.webp 480w') && page.includes('imagesizes="100vw"'), "The hero does not preload and render responsive WebP sources.");
assert(page.includes('src="/landing/open-plan-living.jpg"') && page.includes('src="/landing/open-plan-living-dirty.jpg"'), "The responsive hero removed its legacy JPEG fallbacks.");

// Without these the clip is served as application/octet-stream, and a <video>
// will not play that at all: the poster stays up and nothing ever happens.
for (const [extension, type] of [[".mp4", "video/mp4"], [".jpg", "image/jpeg"], [".png", "image/png"], [".webp", "image/webp"]]) {
  assert(server.includes(`"${extension}": "${type}"`), `The server does not serve ${extension} as ${type}, so the landing media cannot load.`);
}

/* ── Motion behaves ─────────────────────────────────── */

// The animation must run on phones too, not fall back to a static page: the
// script only skips motion for prefers-reduced-motion, never for screen width.
assert(script.includes('matchMedia("(prefers-reduced-motion: reduce)")') && !script.includes("max-width"), "The scroll script disables the animation by screen width instead of only for reduced motion.");
assert(script.includes("if (!this.motion) { this.settle(); return; }"), "Reduced motion leaves the page at its first frame instead of its finished state.");
assert(/@media \(prefers-reduced-motion: reduce\)/.test(css) && /animation: none !important/.test(css), "The landing CSS does not respect reduced-motion preferences.");
// Layout reads are confined to one half of the frame; a getBoundingClientRect in
// the write half would thrash layout on every scroll event.
assert(script.includes("/* ---- read phase: rects only ---- */") && script.includes("/* ---- write phase ---- */"), "The scroll frame no longer separates its layout reads from its style writes.");
assert(script.includes("if (moving) this.raf = requestAnimationFrame(this.frame);"), "The scroll loop no longer stops itself when nothing is moving.");

/* ── Account-first links and flows preserved ───────── */

assert(!page.includes("data-directory-entry") && !page.includes('href="/request"') && !page.includes('href="/join"') && !page.includes('href="/cleaners"'), "The retired public directory or intake journeys are still linked from the landing page.");
assert(!/vetted professionals|verified cleaners|background[- ]checked cleaners|insured cleaners/i.test(page), "The private-pilot homepage makes an unsupported public Cleaner trust claim.");
// Marketing imagery must never be presented as live marketplace supply. These
// were stock-photo personas in the design handoff, with invented ratings and
// job totals. The cards now explain product capabilities instead.
for (const unsupportedClaim of [
  "Marta", "Andrei", "Grace", "Iulia", "Trusted people.", "LONDON PILOT",
  "no account required", "no account needed", "Book as a guest", "Sign up in 30 seconds",
  "412 CLEANS", "288 CLEANS", "96 CLEANS", "173 CLEANS", "4.97", "4.91", "5.00", "4.95",
  "£42"
]) {
  assert(!page.includes(unsupportedClaim), `The landing page reintroduced the unsupported claim: ${unsupportedClaim}.`);
}
for (const truthfulPromise of [
  "Review the scope.", "No camera or room photos required", "Sign in to book",
  "The work stays clear.", "Verified account", "COVERAGE CONFIRMED BEFORE MATCHING"
]) {
  assert(page.includes(truthfulPromise), `The landing page lost the grounded promise: ${truthfulPromise}.`);
}
assert((page.match(/data-book-entry/g) || []).length >= 2 && (page.match(/data-cleaner-entry/g) || []).length >= 1, "The redesign dropped the role-aware booking or cleaner entry hooks home.js drives.");
assert(page.includes('class="ci-signup-menu" data-signup-menu') && page.includes('aria-label="Choose how you want to use Homle"'), "The landing header does not expose an accessible two-role Sign up menu.");
assert(page.includes("data-account-menu hidden") && page.includes("data-account-avatar") && page.includes("data-account-entry hidden") && page.includes("/account-menu.js?"), "The account menu, avatar or sign-in state hooks were lost.");
assert(page.includes("data-year") && page.includes("apple-mobile-web-app-capable"), "The footer year hook or the installable-app metadata was dropped.");

// This page does not load styles.css, so the account menu it inherits from the
// shared sheet has to be dressed for the dark surface here instead.
assert(css.includes(".ci-account .account-menu-panel") && css.includes(".ci-account .account-avatar"), "The signed-in account menu has no styling on the dark landing surface.");

// Arrows on the entry buttons are CSS pseudo-elements. home.js rewrites every
// [data-book-entry] with textContent, which would delete a real child arrow node.
assert(!page.includes("↗") && !page.includes("&#8599;") && !page.includes("→") && !page.includes("&rarr;"), "An arrow glyph is in the markup; home.js textContent updates would erase it. Use a CSS pseudo-element.");
assert(css.includes(".ci-signup::after") && css.includes(".ci-btn-join::after") && css.includes(".ci-btn-primary::after"), "The CTA arrows are not drawn as pseudo-elements.");
assert(css.includes(".ci-signup-panel") && css.includes("@keyframes ci-signup-open") && css.includes(".ci-signup-menu[hidden]"), "The role chooser is not a smooth, session-hideable landing control.");

// The web scanner cannot infer physical area without a user-confirmed scale
// reference. Its own overlay refuses to display square metres, so the public
// animation must not promise automatic floor/worktop measurements either.
assert(!/m(?:&sup2;|²)/.test(page) && !/m²|Measuring floor area/.test(script) && !script.includes("data-area"), "The landing animation claims unsupported physical measurements.");
assert(page.includes("scan in progress") && script.includes("Reading floor condition"), "The truthful condition/readiness replacement for fake area values is missing.");

// Every call to action reaches a route the server actually serves, so no act of
// the design dead-ends on the in-page anchors it was prototyped against.
for (const link of ['href="/landlord/book"', 'href="/login"', 'href="/signup?intent=book"', 'href="/signup?intent=work"', 'href="/privacy"', 'href="/terms"']) {
  assert(page.includes(link), `The landing page no longer offers ${link}.`);
}
for (const route of ["/landlord/book", "/privacy", "/terms", "/login", "/signup"]) {
  assert(server.includes(`"${route}":`), `The landing page links ${route}, which the server does not route.`);
}
// The two in-page anchors the nav and footer scroll to must exist as real ids.
for (const anchor of ["ci-scan", "ci-manual"]) {
  assert(page.includes(`id="${anchor}"`), `The landing page links #${anchor} but has no such section.`);
}

assert(!page.includes("data-guided-kind") && !page.includes("/app.js"), "The landing page pulled in the pilot forms or the heavy intake script.");

// Nothing here overwrites the shared home.js contract.
assert(homeScript.includes("applyEntryMode") && homeScript.includes("[data-book-entry]"), "The shared home.js entry logic was disturbed.");
assert(homeScript.includes('hasAttribute("data-entry-label-fixed")'), "Role-aware homepage updates can overwrite the fixed CTA labels.");

console.log("Landing UI tests passed: CSP-safe, self-hosted media, all six acts wired to real routes.");

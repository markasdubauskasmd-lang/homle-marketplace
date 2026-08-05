import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";

function assert(condition, message) { if (!condition) throw new Error(message); }

const [page, css, script, homeScript, server] = await Promise.all([
  readFile(new URL("../public/home.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landing-7fbca0c2.css", import.meta.url), "utf8"),
  readFile(new URL("../public/landing-5da99005.js", import.meta.url), "utf8"),
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

assert(page.includes('<body class="ci-body">') && page.includes('href="/landing-7fbca0c2.css"') && page.includes('src="/landing-5da99005.js"'), "The landing page does not load its content-addressed scoped stylesheet and scroll script.");
assert(page.includes('<link rel="sitemap" type="application/xml" href="/sitemap.xml">'), "The public landing page does not advertise Homlle's canonical sitemap.");
assert(page.includes('<link rel="canonical" href="https://homlle.com/">') && page.includes('<meta property="og:url" content="https://homlle.com/">'), "The public landing page does not declare the exact canonical production URL.");
for (const metadata of [
  '<meta property="og:type" content="website">',
  '<meta property="og:site_name" content="Homle">',
  '<meta property="og:locale" content="en_GB">',
  '<meta property="og:title" content="Homle — cleaning, understood clearly">',
  '<meta property="og:description"',
  '<meta property="og:image" content="https://homlle.com/landing/open-plan-living-1600-c403e366.webp">',
  '<meta property="og:image:width" content="1600">',
  '<meta property="og:image:height" content="1066">',
  '<meta property="og:image:alt"',
  '<meta name="twitter:card" content="summary_large_image">',
  '<meta name="twitter:title"',
  '<meta name="twitter:description"',
  '<meta name="twitter:image" content="https://homlle.com/landing/open-plan-living-1600-c403e366.webp">',
  '<meta name="twitter:image:alt"'
]) assert(page.includes(metadata), `The public landing page is missing share metadata: ${metadata}`);
assert(!page.includes("onrender.com"), "The public landing metadata exposes the infrastructure preview hostname.");
assert(!page.includes('/landing.css?') && !page.includes('/landing.js?'), "The landing page regressed to stable code URLs that must be revalidated on every visit.");
assert(createHash("sha256").update(css).digest("hex") === "7fbca0c227ad5db2480d89cb476b3c9b3bef866ccd02b94a01a397778b5c0f31", "The landing stylesheet changed without receiving a new content-addressed filename.");
assert(createHash("sha256").update(script).digest("hex") === "5da99005d8982faa12833a0e9a6fd817203bd7870aaf07ddd6fec20a55cc1087", "The landing animation script changed without receiving a new content-addressed filename.");
assert(server.includes('"/landing-7fbca0c2.css"') && server.includes('"/landing-5da99005.js"'), "The landing code is not isolated inside the immutable public-asset allow-list.");
assert(page.includes("data-phone-source") && script.includes("this.phoneSource") && script.includes("ANGLE_WEBP"), "The phone view cannot update its visible WebP source as the scan story changes angle.");
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
  "cleaning-720-e8b1a7ce.mp4", "open-plan-living.jpg", "open-plan-living-dirty.jpg", "dark-kitchen.jpg",
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

// The scanner animation used five photographs encoded as PNGs, totalling more
// than 1.6 MB. Preserve each PNG fallback while modern clients receive the
// reviewed content-addressed WebP. These hashes protect the animation's exact
// room sequence from a quiet visual substitution disguised as compression.
const scanAngleAssets = new Map([
  ["angle-1-664cb339.webp", [25_538, "664cb3394b6d6b28ecb4d77db75de507cb43d386acc92151a61fc2f80a9626c6"]],
  ["angle-2-d071de5c.webp", [24_014, "d071de5c6bd8faa68b219180bc5e1ed5928600df16c24610075c5cb059f8f9a2"]],
  ["angle-3-6a19ea10.webp", [27_336, "6a19ea10029405ffd8ba4a6060d17364b4e5e404a0d8a66e7ee021a6975675a2"]],
  ["angle-4-7f1915b0.webp", [16_654, "7f1915b07a28bf4ea3ac0d32a9d32a2e2b13ef4183d4330a0d1e7957712a4175"]],
  ["angle-5-b3d670d8.webp", [8_862, "b3d670d8aca2ad30e1436226466b9044f99aae3fb0838eb2009fd28e5691f3bd"]]
]);
let scanAngleTransfer = 0;
for (const [file, [expectedBytes, expectedHash]] of scanAngleAssets) {
  const body = await readFile(new URL(`../public/landing/${file}`, import.meta.url));
  scanAngleTransfer += body.length;
  assert(body.length === expectedBytes, `Scanner-animation asset ${file} changed size without review.`);
  assert(createHash("sha256").update(body).digest("hex") === expectedHash, `Scanner-animation asset ${file} changed visual bytes without review.`);
  assert(page.includes(`/landing/${file}`), `Scanner-animation asset ${file} is not wired into the homepage.`);
  assert(server.includes(`"/landing/${file}"`), `Scanner-animation asset ${file} is not in the immutable cache allow-list.`);
}
const originalScanAngleTransfer = (await Promise.all([1, 2, 3, 4, 5].map((angle) => stat(new URL(`../public/landing/angle-${angle}.png`, import.meta.url))))).reduce((sum, info) => sum + info.size, 0);
assert(scanAngleTransfer <= originalScanAngleTransfer * 0.07, "The scanner-animation WebP path no longer saves at least 93% versus its PNG fallbacks.");
assert((page.match(/<picture><source type="image\/webp" srcset="\/landing\/angle-/g) || []).length === 5, "The five scanner-animation frames do not provide WebP sources with PNG fallbacks.");

// The lower half of the page still carried seven full-resolution JPEGs after
// the hero and scanner frames were fixed. Pin every reviewed derivative and
// keep the original JPEGs in the markup so older browsers retain the approved
// composition. The wide-path comparison includes both the phone image and the
// separate video poster because a complete visitor can request both URLs.
const responsiveSupportingAssets = new Map([
  ["dark-kitchen-480-2dad9656.webp", [20_620, "2dad9656ce9eaaa91e65b8e8cdfb6c17aea72c043369b14a25d99ae852a9d9d7"]],
  ["dark-kitchen-960-f761f9b4.webp", [59_166, "f761f9b4677c6ebbeeaccb2564fe0203d27bad86a272c1292134ea846b200a36"]],
  ["dark-kitchen-1600-f930f4ce.webp", [125_076, "f930f4ce9a663fb5bbd2f24797a67612e6715b6ec1482431fede03f325e4ee7d"]],
  ["sage-living-480-bdf0e74d.webp", [20_432, "bdf0e74d01501fa5a44ffd1626c3727253d56d93674910dfb65c7b5898a3e950"]],
  ["sage-living-960-e4022c28.webp", [64_084, "e4022c284df3d6b86fcbd58a54cebe696481a2138a9139ee4c4c019087d348bd"]],
  ["sage-living-1600-fed719d6.webp", [157_374, "fed719d6277fdab253cb9e6c9da2eaeb228b2cd6a0d513fdcbc1f3ea18529bbb"]],
  ["people-backdrop-480-d6fa13df.webp", [13_020, "d6fa13df59d83c5e1a704aa9e415a39b52a76ac4fc16a985c7f55b38ed6e76f9"]],
  ["people-backdrop-960-8a9c8f83.webp", [32_546, "8a9c8f83cd79171b890739bf3d1d4f0ad2adab1e0aeb8ed8a8193a965f97df43"]],
  ["people-backdrop-1600-2eb86892.webp", [80_484, "2eb86892747cfb9aa942f0e7d29ec0008bed3b9e79818d3140951c15d6737847"]],
  ["people-backdrop-2000-8b9c3a29.webp", [157_854, "8b9c3a291038218753ab9d8c6304b190abc990b2579658a03f926d1fdcf3b9c5"]],
  ["person-marta-320-4852e577.webp", [13_354, "4852e57755caf1c141feb44f77f9e9aa1df85e87d4cd0e84124694f1a00d59bb"]],
  ["person-marta-640-a6f84fb2.webp", [33_148, "a6f84fb26aaf62ca6387097d9d45902620923884f7a5a67be172e29d246596c0"]],
  ["person-andrei-320-354d4801.webp", [8_196, "354d4801f4fab4a9730bbd6760173c2909b617503af519b9e77d7ddb716e0332"]],
  ["person-andrei-640-29a2f2dd.webp", [24_020, "29a2f2dd5a6fc680e60e0fc3cd7058a1e9427aeb0ef924ec7caebb22b63bb6db"]],
  ["person-grace-320-8ff237c2.webp", [8_300, "8ff237c248644dcf9052ad6b58944540a8ef91ad0b4bef9287374604353bd196"]],
  ["person-grace-640-1dd1df0e.webp", [22_598, "1dd1df0e9f6814012f5454900e37e01df9dc636e0fc1c1c55aaeba99728fb6bf"]],
  ["person-iulia-320-101559af.webp", [23_930, "101559af2224737edcae680a8426f6cbbc336d2f7d29a0c6a127fefbf66034a9"]],
  ["person-iulia-640-9c0a329d.webp", [75_320, "9c0a329dbbe344310cfa9b07237c490ee55f22c0a1064070694633fb753ad092"]]
]);
for (const [file, [expectedBytes, expectedHash]] of responsiveSupportingAssets) {
  const body = await readFile(new URL(`../public/landing/${file}`, import.meta.url));
  assert(body.length === expectedBytes, `Supporting landing asset ${file} changed size without review.`);
  assert(createHash("sha256").update(body).digest("hex") === expectedHash, `Supporting landing asset ${file} changed visual bytes without review.`);
  assert(page.includes(`/landing/${file}`), `Supporting landing asset ${file} is not wired into the homepage.`);
  assert(server.includes(`"/landing/${file}"`), `Supporting landing asset ${file} is not in the immutable cache allow-list.`);
}
const supportingFallbacks = ["dark-kitchen.jpg", "sage-living.jpg", "people-backdrop.jpg", "person-marta.jpg", "person-andrei.jpg", "person-grace.jpg", "person-iulia.jpg"];
const originalSupportingTransfer = (await Promise.all(supportingFallbacks.map((file) => stat(new URL(`../public/landing/${file}`, import.meta.url))))).reduce((sum, info) => sum + info.size, 0);
const reviewedWideTransfer = [59_166, 125_076, 157_374, 157_854, 33_148, 24_020, 22_598, 75_320].reduce((sum, bytes) => sum + bytes, 0);
assert(reviewedWideTransfer <= originalSupportingTransfer * 0.41, "The complete supporting-photo WebP path no longer saves at least 59% versus its JPEG fallbacks.");
assert(supportingFallbacks.every((file) => page.includes(`src="/landing/${file}"`)), "The responsive supporting photographs removed an approved JPEG fallback.");
assert(page.includes('data-video-poster="/landing/dark-kitchen-1600-f930f4ce.webp"') && !new RegExp('<video[^>]*\\sposter=').test(page), "The reviewed video poster is missing or still joins the initial page request path.");
assert(page.includes('sizes="(max-width: 720px) 1px, (max-width: 1080px) 180px, 240px"'), "Hidden mobile capability cards can still request desktop-size portraits.");

// The clip is always muted, so its old 128 kb/s audio stream downloaded bytes
// without giving a visitor anything. This reviewed H.264 encode removes that
// stream, keeps the broadly compatible codec and puts `moov` before `mdat` so
// metadata is available at the start of the response. The content hash makes
// the year-long cache safe; pin its exact bytes and measured transfer saving.
const optimizedClipFile = "cleaning-720-e8b1a7ce.mp4";
const optimizedClipBytes = await readFile(new URL(`../public/landing/${optimizedClipFile}`, import.meta.url));
assert(optimizedClipBytes.length === 926_233, `The reviewed landing clip changed size: ${optimizedClipBytes.length}.`);
assert(createHash("sha256").update(optimizedClipBytes).digest("hex") === "e8b1a7ce4e654b3f1fe18e94aceb954594fed0e7dbf640a73eb400535bfcb6e3", "The reviewed landing clip bytes changed without a new content-addressed filename.");
const optimizedClipBoxes = optimizedClipBytes.toString("latin1");
assert(optimizedClipBoxes.indexOf("moov") > 0 && optimizedClipBoxes.indexOf("moov") < optimizedClipBoxes.indexOf("mdat"), "The optimized clip lost its fast-start metadata order.");
assert(!optimizedClipBoxes.includes("soun"), "The muted landing clip regained an unused audio track.");
assert(optimizedClipBytes.length <= 2_501_348 * 0.38, "The optimized clip no longer saves at least 62% versus the retired payload.");
assert(page.includes(`data-video-src="/landing/${optimizedClipFile}"`) && page.includes('preload="none"') && !new RegExp(`<video[^>]*\\ssrc="/landing/${optimizedClipFile}"`).test(page) && !page.includes('src="/landing/cleaning.mp4"'), "The homepage can request a landing clip before its below-the-fold act approaches, or still references the retired 2.5 MB clip.");
assert(script.includes('this.detailVideo.setAttribute("src", this.detailVideoSource)') && script.includes("this.activateDetailVideo();"), "The deferred landing clip never activates when its act approaches.");
assert(script.includes('this.detailVideo.setAttribute("poster", this.detailVideoPoster)'), "The deferred landing poster never activates with its clip.");
assert(server.includes(`"/landing/${optimizedClipFile}"`), "The optimized clip is missing from the immutable cache allow-list.");

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

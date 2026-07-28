import { readFile, stat } from "node:fs/promises";

function assert(condition, message) { if (!condition) throw new Error(message); }

const [page, css, hero, homeScript, tokens] = await Promise.all([
  readFile(new URL("../public/home.html", import.meta.url), "utf8"),
  readFile(new URL("../public/home.css", import.meta.url), "utf8"),
  readFile(new URL("../public/home-hero.js", import.meta.url), "utf8"),
  readFile(new URL("../public/home.js", import.meta.url), "utf8"),
  readFile(new URL("../public/homle-tokens.css", import.meta.url), "utf8")
]);

/* ── Content-Security-Policy safety ─────────────────── */

// The site serves this page under style-src 'self' / script-src 'self' with no
// 'unsafe-inline'. An inline style attribute or an off-origin font would be
// dropped on the live site, leaving the page unstyled — the whole reason the
// design is rebuilt here rather than shipped as-is.
assert(!/\sstyle=/.test(page), "The landing page uses inline style attributes, which the CSP blocks.");
assert(!/https?:\/\//.test(css) && !css.includes("fonts.googleapis") && !css.includes("fonts.gstatic"), "The landing CSS pulls a stylesheet or font from off-origin, which the CSP blocks.");
assert(!/https?:\/\//.test(hero) && !hero.includes("eval(") && !hero.includes("new Function"), "The scroll script loads off-origin or uses eval, which the CSP blocks.");

// The fonts are self-hosted, under the immutable /vendor/ path, with their OFL.
// They are declared in homle-tokens.css now rather than here: the identical pair
// was repeated in three stylesheets, and the whole app reads them from one owner
// so the landing page and the dashboards cannot drift onto different typefaces.
assert(!/https?:\/\//.test(tokens) && !tokens.includes("fonts.googleapis") && !tokens.includes("fonts.gstatic"), "The shared design tokens pull a font from off-origin, which the CSP blocks.");
assert(tokens.includes('url("/vendor/fonts/bricolage-grotesque-wght.woff2")') && tokens.includes('url("/vendor/fonts/dm-sans-wght.woff2")'), "The landing typography is not self-hosted from /vendor/fonts.");
// Comments are stripped first: the file deliberately EXPLAINS where the fonts
// went, and that prose must not be mistaken for a declaration.
assert(!/@font-face\s*\{/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), "home.css declares the fonts again. One owner, or the landing page and the app can drift onto different files of the same family.");
// And the landing page still USES them — the tokens are worth nothing if the
// page that defines the look stops reading from them.
assert(css.includes("--lp-display") && css.includes("Bricolage Grotesque"), "The landing page no longer references its own display family.");
for (const file of ["bricolage-grotesque-wght.woff2", "dm-sans-wght.woff2", "OFL.txt"]) {
  const info = await stat(new URL(`../public/vendor/fonts/${file}`, import.meta.url));
  assert(info.isFile() && info.size > 0, `Vendored font asset ${file} is missing.`);
}

/* ── The design is actually wired in ────────────────── */

assert(page.includes('<body class="landing">') && page.includes('href="/home.css') && page.includes('src="/home-hero.js'), "The landing page does not load its scoped stylesheet and scroll script.");
assert(page.includes('href="/styles.css?v=20260728-3"') && page.includes('href="/home.css?v=20260728-2"') && page.includes('src="/home-hero.js?v=20260723-1"'), "The landing page still advertises stale shared, animation or landing-style assets, so browsers can miss the latest motion.");
// Every rule is scoped under body.landing so nothing leaks into the pages that
// share styles.css. A top-level selector would begin a line with `.` or `#`.
assert(css.includes("body.landing") && !/\n[.#][a-zA-Z]/.test(css), "A landing CSS rule is not scoped under body.landing and could leak into other pages.");
assert(page.includes("data-scan-wrap") && page.includes("lp-phone") && page.includes("data-beam") && page.includes("lp-calm") && page.includes("lp-details"), "The scan hero, phone, calm or details sections of the design are missing.");

// Arrows and dots on the entry buttons are CSS pseudo-elements. home.js rewrites
// every [data-book-entry] with textContent, which would delete a real child
// arrow node — so none may appear in the markup.
assert(!page.includes("↗"), "An arrow glyph is in the markup; home.js textContent updates would erase it. Use a CSS pseudo-element.");
assert(css.includes(".lp-btn-primary::after") && css.includes(".lp-btn-dark::after"), "The CTA arrows are not drawn as pseudo-elements.");

/* ── Account-first links and flows preserved ───────── */

assert(!page.includes("data-directory-entry") && !page.includes('href="/request"') && !page.includes('href="/join"'), "The retired public directory or intake journeys are still linked from the landing page.");
assert(page.includes('href="/signup?intent=work" data-cleaner-entry>Work as a cleaner</a>'), "The Cleaner account entry changed target or lost its hook.");
assert(page.includes('href="/signup?intent=book" data-book-entry>Create Landlord profile</a>'), "The Landlord account entry changed target or lost its hook.");
assert((page.match(/data-book-entry/g) || []).length >= 4 && (page.match(/data-cleaner-entry/g) || []).length >= 4, "The redesign dropped the role-aware booking or cleaner entry hooks home.js drives.");
assert(page.includes("data-account-menu hidden") && page.includes("data-account-avatar") && page.includes("data-account-entry hidden") && page.includes("/account-menu.js?"), "The account menu, avatar or sign-in state hooks were lost.");
assert(page.includes('data-entry-status aria-live="polite"') && page.includes("Landlords and Cleaners now use their separate private dashboards"), "The account-first status line home.js updates was removed.");
assert(page.includes('data-year') && page.includes("apple-mobile-web-app-capable"), "The footer year hook or the installable-app metadata was dropped.");

// "How it works" was intentionally removed; nothing should still link to a dead
// #how-it-works anchor, and no forms or intake script belong on this page.
assert(!page.includes('href="#how-it-works"') && !page.includes(">How it works<"), "The removed How it works tab still has a link or a dead anchor.");
assert(!page.includes("data-guided-kind") && !page.includes("/app.js"), "The landing page pulled in the pilot forms or the heavy intake script.");

// The header carries only the two role-account actions.
assert(/<nav[\s\S]*?<\/nav>/.test(page), "The primary nav is missing.");
const nav = page.match(/<nav[\s\S]*?<\/nav>/)[0];
assert(nav.includes("data-cleaner-entry") && nav.includes("data-book-entry") && !nav.includes("data-directory-entry"), "The header should show only the Cleaner and Landlord account actions.");

// The scan animation must run on phones too, not fall back to a static image:
// the stage is never un-pinned by CSS and the script only skips motion for
// prefers-reduced-motion, never for screen width.
assert(!/\.lp-scene\s*\{[^}]*display:\s*none/.test(css) && !/\.lp-stage\s*\{[^}]*position:\s*static/.test(css), "The scan scene or stage is switched off on small screens, so the animation cannot run on a phone.");
assert(hero.includes("return still.matches") && !hero.includes('matchMedia("(max-width'), "The scroll script disables the animation by screen width instead of only for reduced motion.");
assert(hero.includes("if (still.matches) { firedMilestones.clear(); return; }"), "Reduced-motion mode can still trigger landing-page milestone haptics.");
assert(css.includes("translate(var(--lp-phone-x, 0px), var(--lp-phone-y, 0px)) rotate(-6deg)") && hero.includes('style.setProperty("--lp-phone-x"') && hero.includes('style.removeProperty("--lp-phone-x")') && !hero.includes("el.phone.style.transform ="), "Desktop parallax replaces the phone's designed tilt instead of composing with it and restoring it on pointer exit.");

// Nothing here overwrites the shared home.js contract.
assert(homeScript.includes("applyEntryMode") && homeScript.includes("[data-book-entry]"), "The shared home.js entry logic was disturbed.");

console.log("Landing UI tests passed: CSP-safe, scoped, account-first and free of retired public journey links.");

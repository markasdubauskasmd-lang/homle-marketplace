import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";

function assert(condition, message) { if (!condition) throw new Error(message); }

const publicRoot = new URL("../public/", import.meta.url);
const publicFiles = (await readdir(publicRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(?:html|js|svg|webmanifest)$/.test(entry.name))
  .map((entry) => entry.name);
const visibleOldBrand = /(?<![A-Za-z0-9_-])Tideway(?![A-Za-z0-9_-])/;
// Derived, not pinned. The version is bumped on every deployment that touches
// styles.css (docs/BRAND_AND_UI.md rule 4), and hard-coding it here meant a
// routine cache bump failed a brand test. What this guarantees is unchanged and
// is the thing that actually matters: every public page loads the SAME current
// version, so none of them serves a stale stylesheet.
// The landing page is deliberately outside the shared sheet: it is a
// self-contained dark cinematic design with its own content-addressed scoped
// stylesheet, and
// loading styles.css on top of it would fight its typography and surface. The
// version is therefore anchored on account.html, the first page every visitor
// reaches after it, and home.html is exempted from the shared-sheet rule alone.
// The owner-uploaded onboarding previews are design references, not the live
// registration route. Like the landing page, each has its own isolated sheet.
// They retain the favicon requirement and their assets/routing are verified
// below in a real browser; adding styles.css would overwrite the supplied design.
const onboardingPreviewSheets = new Map([
  ["homlle-onboarding.html", "/homlle-onboarding.css?v=0906b"],
  ["onboarding-preview-v3.html", "/onboarding-preview-v3.css?v=20260906-1"]
]);
const standaloneDesignPages = new Set(["home.html", ...onboardingPreviewSheets.keys()]);
// Public and Landlord pages display the approved 1254 px artwork at no more than
// 54 CSS pixels. Loading the 1.97 MB source there delayed the first useful paint
// on mobile. These pages use a locked 128 px lossless derivative; Cleaner pages
// deliberately retain their existing asset and are outside this performance edit.
const compactLogoByPage = new Map([
  ["account.html", "/homle-logo-192-c8defd4b.png"],
  ["facebook-data-deletion.html", "/homle-logo-128-4f82ebad.png"],
  ["home.html", "/homle-logo-128-4f82ebad.png"],
  ["landlord-checkout.html", "/homle-logo-128-4f82ebad.png"],
  ["landlord-dashboard.html", "/homle-logo-128-4f82ebad.png"],
  ["landlord-help.html", "/homle-logo-128-4f82ebad.png"],
  ["landlord-journey.html", "/homle-logo-128-4f82ebad.png"],
  ["privacy.html", "/homle-logo-128-4f82ebad.png"],
  ["terms.html", "/homle-logo-128-4f82ebad.png"]
]);
const anchorMarkup = await readFile(new URL("account.html", publicRoot), "utf8");
const sharedStyleVersion = /\/styles\.css\?v=([\w-]+)/.exec(anchorMarkup);
if (!sharedStyleVersion) throw new Error("account.html no longer loads a versioned styles.css, so no page can be checked against it.");
const sharedStyleAsset = `/styles.css?v=${sharedStyleVersion[1]}`;

for (const name of publicFiles) {
  const source = await readFile(new URL(name, publicRoot), "utf8");
  assert(!visibleOldBrand.test(source), `Public asset ${name} still exposes the old Tideway brand.`);
  if (name.endsWith(".html")) {
    assert(!source.includes('/favicon.svg'), `Public page ${name} still references the removed fallback favicon instead of the approved Homle logo.`);
    const expectedLogo = compactLogoByPage.get(name) || "/homle-logo.png";
    assert(source.includes(`<link rel="icon" href="${expectedLogo}" type="image/png">`), `Public page ${name} omitted its approved Homle tab icon.`);
    if (standaloneDesignPages.has(name)) {
      assert(!source.includes("/styles.css"), `Public page ${name} is a standalone design and must not load the shared sheet.`);
      continue;
    }
    assert(source.includes(sharedStyleAsset), `Public page ${name} does not load the current shared design and animation asset.`);
  }
}

const [home, account, landlordDashboard, cleanerDashboard, landlordJourney, roomScan, activeJob, logo, compactLogo128, compactLogo192, manifest, server, emailWorker] = await Promise.all([
  readFile(new URL("../public/home.html", import.meta.url), "utf8"),
  readFile(new URL("../public/account.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-journey.html", import.meta.url), "utf8"),
  readFile(new URL("../public/room-scan.html", import.meta.url), "utf8"),
  readFile(new URL("../public/active-job.html", import.meta.url), "utf8"),
  readFile(new URL("../public/homle-logo.png", import.meta.url)),
  readFile(new URL("../public/homle-logo-128-4f82ebad.png", import.meta.url)),
  readFile(new URL("../public/homle-logo-192-c8defd4b.png", import.meta.url)),
  readFile(new URL("../public/site.webmanifest", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/marketplace/email-notification-worker.mjs", import.meta.url), "utf8")
]);

assert(home.includes("Homle") && account.includes("Homle") && home.includes('/homle-logo-128-4f82ebad.png') && account.includes('/homle-logo-192-c8defd4b.png'), "The homepage or account entry does not use its approved compact Homle brand asset.");
assert(landlordJourney.includes('<link rel="icon" href="/homle-logo-128-4f82ebad.png" type="image/png">') && roomScan.includes('<link rel="icon" href="/homle-logo.png" type="image/png">'), "The guided booking or legacy scanner surface does not use its approved Homle tab icon.");
assert(createHash("sha256").update(logo).digest("hex") === "cd2edfaae101cc579a97d3dce3743b0c7971b29345db240730be58681b475f36", "The public logo differs from the exact artwork approved by the owner.");
assert(createHash("sha256").update(compactLogo128).digest("hex") === "4f82ebad6fe8c81f219b9691ce5c38e371998facdec074e57df3457d8d6a6568" && compactLogo128.length <= 20_000, "The 128 px public logo is not the reviewed lossless derivative or has regained excessive transfer weight.");
assert(createHash("sha256").update(compactLogo192).digest("hex") === "c8defd4b4fa90ab3fbc46c4649a8ea5f04a18e24080b20f3a4155d2fb06d9fbe" && compactLogo192.length <= 40_000, "The 192 px account-entry logo is not the reviewed lossless derivative or has regained excessive transfer weight.");
assert(cleanerDashboard.includes('/homle-logo.png') && !cleanerDashboard.includes('/homle-logo-128-4f82ebad.png') && !cleanerDashboard.includes('/homle-logo-192-c8defd4b.png'), "The public-page logo optimisation changed the Cleaner Dashboard asset boundary.");
assert(server.includes('"/homle-logo-128-4f82ebad.png"') && server.includes('"/homle-logo-192-c8defd4b.png"') && server.includes('vendored || immutablePublicAsset ? "public, max-age=31536000, immutable" : "no-cache"'), "The content-addressed public logos are not isolated behind immutable caching.");
assert(server.includes('requestUrl.pathname === "/favicon.ico"') && server.includes('"Location": "/homle-logo-128-4f82ebad.png"') && server.includes('"Cache-Control": "no-cache"'), "The conventional browser favicon path does not revalidate against the approved compact Homle icon.");
const parsedManifest = JSON.parse(manifest);
assert(parsedManifest.name === "Homle Cleaning" && parsedManifest.short_name === "Homle", "The installable web-app name is not Homle.");
assert(parsedManifest.id === "/" && parsedManifest.scope === "/" && parsedManifest.display === "standalone" && parsedManifest.lang === "en-GB", "The installed Homle identity or navigation scope is incomplete.");
assert(parsedManifest.icons.some((icon) => icon.src === "/app-icon-192.png" && icon.sizes === "192x192") && parsedManifest.icons.some((icon) => icon.src === "/app-icon-512.png" && icon.sizes === "512x512") && parsedManifest.icons.some((icon) => icon.src === "/app-icon-maskable-512.png" && icon.purpose === "maskable"), "The web-app manifest omitted required phone icons or its maskable icon.");
const shortcutUrls = parsedManifest.shortcuts.map((shortcut) => shortcut.url);
assert(["/landlord/book", "/landlord/dashboard", "/cleaner/dashboard"].every((url) => shortcutUrls.includes(url)) && !shortcutUrls.includes("/request") && !shortcutUrls.includes("/join"), "The installed app omitted a secure dashboard shortcut or retained a retired public journey.");
assert(parsedManifest.shortcuts.find((shortcut) => shortcut.url === "/landlord/book")?.icons?.some((icon) => icon.src === "/app-icon-192.png"), "The one-tap room-scan shortcut omitted its local app icon.");
for (const iconName of ["app-icon-192.png", "app-icon-512.png", "app-icon-maskable-512.png", "apple-touch-icon.png"]) {
  const icon = await stat(new URL(`../public/${iconName}`, import.meta.url));
  assert(icon.isFile() && icon.size > 1000, `Installed-app icon ${iconName} is missing or empty.`);
}
assert(home.includes('name="apple-mobile-web-app-capable" content="yes"') && home.includes('rel="apple-touch-icon" href="/apple-touch-icon.png"'), "The homepage omitted iPhone home-screen metadata.");
for (const [name, page] of [
  ["Landlord dashboard", landlordDashboard],
  ["Cleaner dashboard", cleanerDashboard],
  ["Landlord booking journey", landlordJourney],
  ["room scanner", roomScan],
  ["active job", activeJob]
]) {
  assert(page.includes('name="apple-mobile-web-app-capable" content="yes"') && page.includes('rel="apple-touch-icon" href="/apple-touch-icon.png"') && page.includes('rel="manifest" href="/site.webmanifest"'), `${name} omitted the shared installable-app metadata.`);
}
assert(!visibleOldBrand.test(server) && !visibleOldBrand.test(emailWorker) && emailWorker.includes("Homle:"), "Server-generated customer or notification copy still exposes the old public brand.");
assert(server.includes("TidewayScopeTimeBreakdown") && server.includes("tideway-marketplace"), "The visual rebrand renamed stable internal runtime contracts.");

console.log("Public brand tests passed: Homle is visible across web, account and notification surfaces while stable internal contracts remain unchanged.");

// The preview exception above is deliberately narrower than a blanket bypass:
// exact isolated assets, no crawler indexing, no inline executable code, and no
// replacement of the real registration route. Preview navigation is not proof
// of real registration submission; the existing integration tests cover that.
for (const [name, sheet] of onboardingPreviewSheets) {
  const html = await readFile(new URL(name, publicRoot), "utf8");
  const css = await readFile(new URL(sheet.split("?")[0].slice(1), publicRoot), "utf8");
  assert(html.includes(`href="${sheet}"`), `${name} lost its exact isolated stylesheet.`);
  assert(html.includes('<script src="/homlle-onboarding.js?v=0906b"></script>'), `${name} lost its root-relative screen router.`);
  assert(html.includes('name="robots" content="noindex,nofollow,noarchive"'), `${name} is no longer excluded from indexing.`);
  assert(!/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(html) && !/\son(?:click|submit|change)=/i.test(html), `${name} needs unsafe inline scripts.`);
  assert(!css.includes("600;800&display=swap"), `${name} retains a malformed import that discards its root design tokens.`);
  assert(!server.includes(`": "${name}"`), `${name} replaced a working application route.`);
}

const { launchBrowser, resolveChromiumPath, serveStatic } = await import("../tools/browser-harness.mjs");
if (resolveChromiumPath()) {
  const previewServer = await serveStatic();
  const browser = await launchBrowser();
  try {
    for (const name of onboardingPreviewSheets.keys()) {
      for (const width of [390, 1280]) {
        await browser.setViewport({ width, height: 844, mobile: width === 390 });
        await browser.goto(`${previewServer.origin}/${name}`);
        const initial = await browser.evaluate(`return {
          screen: document.documentElement.dataset.screen,
          rootColor: getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim(),
          visible: [...document.querySelectorAll('.ho-screen')].filter(el => el.checkVisibility()).map(el => el.id),
          brokenImages: [...document.images].filter(el => !el.complete || !el.naturalWidth).map(el => el.src),
          sheets: [...document.styleSheets].map(sheet => sheet.cssRules.length),
          viewport: innerWidth,
          overflow: document.documentElement.scrollWidth > innerWidth
        };`);
        assert(initial.screen === "home" && initial.visible.join() === "home", `${name} ${width}px did not initialize one screen.`);
        assert(initial.rootColor === "#f3f2f2", `${name} ${width}px did not load its design tokens.`);
        assert(initial.sheets.length === 1 && initial.sheets[0] > 100, `${name} did not load its isolated design.`);
        assert(initial.brokenImages.length === 0, `${name} has broken images: ${initial.brokenImages.join(', ')}`);
        assert(initial.viewport === width && !initial.overflow, `${name} ${width}px widened or overflowed the viewport.`);
        await browser.evaluate(`document.querySelector('a[href="#personal-details"]').click(); return null;`);
        const details = await browser.evaluate(`
          const deadline = Date.now() + 3000;
          while (document.documentElement.dataset.screen !== 'personal-details') {
            if (Date.now() > deadline) throw new Error('Preview navigation did not complete');
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          return [...document.querySelectorAll('.ho-screen')].filter(el => el.checkVisibility()).map(el => el.id);
        `);
        assert(details.join() === "personal-details", `${name} ${width}px did not navigate to personal details.`);
        await browser.evaluate(`location.hash = '#missing-screen'; return null;`);
        const fallback = await browser.evaluate(`
          const deadline = Date.now() + 3000;
          while (document.documentElement.dataset.screen !== 'home') {
            if (Date.now() > deadline) throw new Error('Preview fallback did not complete');
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          return document.querySelector('#home').checkVisibility();
        `);
        assert(fallback, `${name} ${width}px left an invalid hash on a blank page.`);
      }
    }
    assert(browser.pageErrors.length === 0, browser.pageErrors.join('\n'));
  } finally { await browser.close(); await previewServer.close(); }
  console.log("Onboarding preview browser checks passed at 390px and 1280px: isolated design tokens, images, screen navigation and invalid-hash recovery. Live registration remains separate.");
} else console.log("Onboarding preview browser checks SKIPPED: Chromium unavailable.");

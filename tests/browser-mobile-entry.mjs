import {
  chromiumExecutableCandidates,
  launchBrowser,
  resolveChromiumPath,
  serveStatic
} from "../tools/browser-harness.mjs";

// A real responsive-browser proof for the public account entry.
//
// Source assertions can confirm that Log in and Sign up exist. They cannot prove
// that responsive CSS leaves either control visible and tappable, that the
// cinematic landing design does not overflow a phone sideways once its acts
// start moving, or that its clip and photography actually load.
//
// This is desktop Chromium using a 390 x 844 emulated viewport. It is not a
// physical-phone or touch trial and does not claim to be one.

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const chromiumPath = resolveChromiumPath();
if (!chromiumPath) {
  console.log(`Browser mobile-entry checks SKIPPED: no Chromium executable found. Checked ${chromiumExecutableCandidates().join(", ")}.`);
  process.exit(0);
}

const server = await serveStatic();
const browser = await launchBrowser();
let failure = null;

try {
  await browser.setViewport({ width: 390, height: 844 });
  await browser.goto(`${server.origin}/home.html`);

  // home.js unhides Log in once it has decided the entry mode. It does that
  // synchronously on import, before its /api/health call resolves.
  const entry = await browser.evaluate(`
    const login = document.querySelector("[data-account-entry]");
    const signup = document.querySelector("[data-book-entry]");
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height }; };
    return {
      width: window.innerWidth,
      documentWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      login: { hidden: login.hidden, href: login.getAttribute("href"), display: getComputedStyle(login).display, ...rect(login) },
      signup: { href: signup.getAttribute("href"), text: signup.textContent.trim(), display: getComputedStyle(signup).display, ...rect(signup) }
    };
  `);
  assert(entry.width === 390, `The responsive proof did not receive the requested viewport: ${entry.width}.`);
  assert(entry.scrollWidth === entry.documentWidth, "The landing page overflows horizontally at 390px.");
  assert(entry.login.hidden === false && entry.login.display !== "none" && entry.login.href === "/login",
    `The mobile Log in control is hidden or misrouted: ${JSON.stringify(entry.login)}.`);
  assert(entry.signup.display !== "none" && entry.signup.href === "/signup?intent=book",
    `The mobile Sign up control is hidden or misrouted: ${JSON.stringify(entry.signup)}.`);
  // The header pair is the only account entry above the fold, so both have to be
  // comfortably tappable and fully inside the viewport.
  for (const [name, control] of [["Log in", entry.login], ["Sign up", entry.signup]]) {
    assert(control.height >= 44 && control.left >= 0 && control.right <= entry.documentWidth,
      `The ${name} control is clipped or too small to tap: ${JSON.stringify(control)}.`);
  }
  // home.js must not have eaten the label: the Sign up entry is label-fixed.
  assert(entry.signup.text === "Sign up", `The Sign up label was overwritten: "${entry.signup.text}".`);

  // Walk the whole page the way a visitor would. Every act pins and unpins, and
  // none of them may push the document sideways while it moves — the design is
  // built from vw-sized transforms, which is exactly how that happens.
  const scrolled = await browser.evaluate(`
    const height = document.documentElement.scrollHeight;
    const documentWidth = document.documentElement.clientWidth;
    let worstScrollWidth = 0;
    for (let i = 0; i <= 24; i++) {
      window.scrollTo(0, Math.round((height - window.innerHeight) * (i / 24)));
      worstScrollWidth = Math.max(worstScrollWidth, document.documentElement.scrollWidth);
    }
    window.scrollTo(0, 0);
    return { documentWidth, worstScrollWidth, height };
  `);
  assert(scrolled.worstScrollWidth === scrolled.documentWidth,
    `Scrolling the landing page creates horizontal overflow: ${scrolled.worstScrollWidth} vs ${scrolled.documentWidth}.`);
  assert(scrolled.height > 844 * 8, `The scroll-driven design collapsed to ${scrolled.height}px, so its acts cannot play.`);

  // The media the design is built on has to actually arrive. A wrong MIME type
  // or a missing file is invisible in source review and fatal on the page.
  const media = await browser.evaluate(`
    const images = [...document.images];
    const video = document.querySelector("[data-detail-video]");
    return new Promise((resolve) => {
      const done = () => resolve({
        total: images.length,
        broken: images.filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.getAttribute("src")),
        pending: images.filter((img) => !img.complete).length,
        videoSrc: video ? video.getAttribute("src") : null,
        videoError: video && video.error ? video.error.code : null,
        videoReady: video ? video.readyState : null
      });
      if (video) video.addEventListener("loadedmetadata", done, { once: true });
      setTimeout(done, 4000);
    });
  `);
  assert(media.total >= 10, `The landing page lost its photography: only ${media.total} images.`);
  assert(media.broken.length === 0, `Landing images failed to load: ${media.broken.join(", ")}.`);
  assert(media.videoSrc === "/landing/cleaning.mp4", `The detail act lost its clip: ${media.videoSrc}.`);
  assert(media.videoError === null, `The landing clip failed to decode, error code ${media.videoError}.`);
  assert(media.videoReady >= 1, "The landing clip never reported metadata, so it will never play.");

  // Reaching the closing act must leave a real sign-up link, not an anchor that
  // scrolls back into the page the way the design prototype did.
  const closing = await browser.evaluate(`
    const join = document.querySelector("[data-stage='join'] a[data-book-entry]");
    const cleaner = document.querySelector("[data-cleaner-entry]");
    return {
      joinHref: join ? join.getAttribute("href") : null,
      joinText: join ? join.textContent.trim() : null,
      cleanerHref: cleaner ? cleaner.getAttribute("href") : null
    };
  `);
  assert(closing.joinHref === "/signup?intent=book", `The closing call to action does not sign anyone up: ${closing.joinHref}.`);
  assert(closing.joinText === "Create your Homle account", `The closing label was overwritten: "${closing.joinText}".`);
  assert(closing.cleanerHref === "/signup?intent=work", `Cleaners cannot sign up from the landing page: ${closing.cleanerHref}.`);

  assert(browser.pageErrors.length === 0,
    `The mobile account entry threw in Chromium: ${browser.pageErrors.join(" | ")}`);
} catch (error) {
  failure = error;
} finally {
  await browser.close();
  await server.close();
}

if (failure) throw failure;
console.log("Browser mobile-entry checks passed: 390px Log in and Sign up, no overflow across all six acts, photography and clip load, real sign-up routes.");

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
    const signupMenu = document.querySelector("[data-signup-menu]");
    const signup = signupMenu.querySelector("summary");
    signupMenu.open = true;
    const bookAccount = signupMenu.querySelector("[data-book-entry]");
    const cleanerAccount = signupMenu.querySelector("[data-cleaner-entry]");
    const heroImages = [...document.querySelectorAll(".ci-hero-img")];
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height }; };
    return {
      width: window.innerWidth,
      documentWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      login: { hidden: login.hidden, href: login.getAttribute("href"), display: getComputedStyle(login).display, ...rect(login) },
      signup: { text: signup.textContent.trim(), display: getComputedStyle(signup).display, ...rect(signup) },
      bookAccount: { href: bookAccount.getAttribute("href"), text: bookAccount.querySelector("strong").textContent.trim(), ...rect(bookAccount) },
      cleanerAccount: { href: cleanerAccount.getAttribute("href"), text: cleanerAccount.querySelector("strong").textContent.trim(), ...rect(cleanerAccount) },
      heroSources: heroImages.map((image) => image.currentSrc),
      detailVideo: (() => {
        const video = document.querySelector("[data-detail-video]");
        return {
          src: video.getAttribute("src"),
          deferredSrc: video.dataset.videoSrc,
          poster: video.getAttribute("poster"),
          deferredPoster: video.dataset.videoPoster,
          readyState: video.readyState
        };
      })()
    };
  `);
  assert(entry.width === 390, `The responsive proof did not receive the requested viewport: ${entry.width}.`);
  assert(entry.scrollWidth === entry.documentWidth, "The landing page overflows horizontally at 390px.");
  assert(entry.login.hidden === false && entry.login.display !== "none" && entry.login.href === "/login",
    `The mobile Log in control is hidden or misrouted: ${JSON.stringify(entry.login)}.`);
  assert(entry.signup.display !== "none" && entry.signup.text === "Sign up",
    `The mobile Sign up control is hidden or mislabelled: ${JSON.stringify(entry.signup)}.`);
  // The header pair is the only account entry above the fold, so both have to be
  // comfortably tappable and fully inside the viewport.
  for (const [name, control] of [["Log in", entry.login], ["Sign up", entry.signup]]) {
    assert(control.height >= 44 && control.left >= 0 && control.right <= entry.documentWidth,
      `The ${name} control is clipped or too small to tap: ${JSON.stringify(control)}.`);
  }
  assert(entry.bookAccount.href === "/signup?intent=book" && entry.bookAccount.text === "Book cleaning" && entry.bookAccount.height >= 48,
    `The mobile customer role is missing, misrouted or too small: ${JSON.stringify(entry.bookAccount)}.`);
  assert(entry.cleanerAccount.href === "/cleaner/onboarding" && entry.cleanerAccount.text === "Work as a cleaner" && entry.cleanerAccount.height >= 48,
    `The mobile Cleaner role is missing, misrouted or too small: ${JSON.stringify(entry.cleanerAccount)}.`);
  assert(entry.heroSources.length === 2 && entry.heroSources.every((source) => source.endsWith(".webp") && source.includes("-480-")),
    `The 390px landing view downloaded a fallback or oversized hero instead of its 480px WebP pair: ${JSON.stringify(entry.heroSources)}.`);
  assert(entry.detailVideo.src === null && entry.detailVideo.deferredSrc === "/landing/cleaning-720-e8b1a7ce.mp4" && entry.detailVideo.readyState === 0,
    `The below-the-fold detail clip joined the initial mobile load: ${JSON.stringify(entry.detailVideo)}.`);
  assert(entry.detailVideo.poster === null && entry.detailVideo.deferredPoster === "/landing/dark-kitchen-1600-f930f4ce.webp",
    `The below-the-fold detail poster joined the initial mobile load: ${JSON.stringify(entry.detailVideo)}.`);

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
  // Move each lazy supporting image through the viewport with a paint between
  // positions. A tight synchronous scroll loop proves layout but deliberately
  // does not give Chromium a chance to schedule lazy image requests.
  await browser.evaluate(`
    return await (async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      for (const selector of ["[data-phone-view]", ".ci-manual-bg", ".ci-people-bg"]) {
        const image = document.querySelector(selector);
        image.scrollIntoView({ block: "center" });
        await wait(180);
        if (!image.complete) await Promise.race([new Promise((resolve) => image.addEventListener("load", resolve, { once: true })), wait(1500)]);
      }
    })();
  `);
  const media = await browser.evaluate(`
    const images = [...document.images];
    const video = document.querySelector("[data-detail-video]");
    return new Promise((resolve) => {
      const done = () => resolve({
        total: images.length,
        broken: images.filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.getAttribute("src")),
        pending: images.filter((img) => !img.complete).length,
        supportingSources: {
          phone: document.querySelector("[data-phone-view]")?.currentSrc || "",
          manual: document.querySelector(".ci-manual-bg")?.currentSrc || "",
          people: document.querySelector(".ci-people-bg")?.currentSrc || "",
          portraits: [...document.querySelectorAll(".ci-person img")].map((img) => img.currentSrc)
        },
        videoSrc: video ? video.getAttribute("src") : null,
        videoDeferredSrc: video ? video.dataset.videoSrc : null,
        videoPoster: video ? video.getAttribute("poster") : null,
        videoError: video && video.error ? video.error.code : null,
        videoReady: video ? video.readyState : null
      });
      if (video) video.addEventListener("loadedmetadata", done, { once: true });
      setTimeout(done, 4000);
    });
  `);
  assert(media.total >= 10, `The landing page lost its photography: only ${media.total} images.`);
  assert(media.broken.length === 0, `Landing images failed to load: ${media.broken.join(", ")}.`);
  assert(media.videoSrc === "/landing/cleaning-720-e8b1a7ce.mp4", `The detail act lost its reviewed content-addressed clip: ${media.videoSrc}.`);
  assert(media.videoDeferredSrc === media.videoSrc, `The activated detail clip no longer matches its reviewed deferred source: ${media.videoDeferredSrc}.`);
  assert(/\/landing\/angle-[1-5]-[0-9a-f]{8}\.webp$/.test(media.supportingSources.phone), `The mobile scanner-phone image did not follow the active room angle with its optimized WebP: ${media.supportingSources.phone}.`);
  assert(/\/landing\/sage-living-(?:480|960)-[0-9a-f]{8}\.webp$/.test(media.supportingSources.manual), `The mobile manual-booking background used an oversized JPEG fallback: ${media.supportingSources.manual}.`);
  assert(/\/landing\/people-backdrop-(?:480|960)-[0-9a-f]{8}\.webp$/.test(media.supportingSources.people), `The mobile handoff background used an oversized JPEG fallback: ${media.supportingSources.people}.`);
  assert(media.supportingSources.portraits.every((source) => source === "" || /-[0-9]{3}-[0-9a-f]{8}\.webp$/.test(source)), `A hidden mobile capability card downloaded a full JPEG: ${JSON.stringify(media.supportingSources.portraits)}.`);
  assert(media.videoPoster === "/landing/dark-kitchen-1600-f930f4ce.webp", `The detail clip retained its full JPEG poster: ${media.videoPoster}.`);
  assert(media.videoError === null, `The landing clip failed to decode, error code ${media.videoError}.`);
  assert(media.videoReady >= 1, "The landing clip never reported metadata, so it will never play.");

  // Reaching the closing act must leave a real sign-up link, not an anchor that
  // scrolls back into the page the way the design prototype did.
  const closing = await browser.evaluate(`
    const join = document.querySelector("[data-stage='join'] a[data-book-entry]");
    const cleaner = document.querySelector("[data-cleaner-entry]");
    const login = document.querySelector(".ci-join-foot a[href='/login']");
    const footerLinks = [...document.querySelectorAll(".ci-footer-links a")];
    const rect = (element) => element ? (() => { const box = element.getBoundingClientRect(); return { width: box.width, height: box.height }; })() : null;
    return {
      joinHref: join ? join.getAttribute("href") : null,
      joinText: join ? join.textContent.trim() : null,
      cleanerHref: cleaner ? cleaner.getAttribute("href") : null,
      login: { href: login ? login.getAttribute("href") : null, ...rect(login) },
      footerLinks: footerLinks.map((link) => ({ href: link.getAttribute("href"), ...rect(link) }))
    };
  `);
  assert(closing.joinHref === "/signup?intent=book", `The closing call to action does not sign anyone up: ${closing.joinHref}.`);
  assert(closing.joinText === "Create your Homle account", `The closing label was overwritten: "${closing.joinText}".`);
  assert(closing.cleanerHref === "/cleaner/onboarding", `Cleaners cannot open dedicated onboarding from the landing page: ${closing.cleanerHref}.`);
  assert(closing.login.href === "/login" && closing.login.height >= 44,
    `The closing Log in link is missing or too small to tap: ${JSON.stringify(closing.login)}.`);
  assert(closing.footerLinks.length === 5 && closing.footerLinks.every((link) => link.height >= 44),
    `The mobile footer links are missing or too small to tap: ${JSON.stringify(closing.footerLinks)}.`);

  assert(browser.pageErrors.length === 0,
    `The mobile account entry threw in Chromium: ${browser.pageErrors.join(" | ")}`);
} catch (error) {
  failure = error;
} finally {
  await browser.close();
  await server.close();
}

if (failure) throw failure;
console.log("Browser mobile-entry checks passed: 390px account and footer touch targets, no overflow across all six acts, photography and clip load, real sign-up routes.");

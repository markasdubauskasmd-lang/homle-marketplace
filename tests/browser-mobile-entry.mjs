import {
  chromiumExecutableCandidates,
  launchBrowser,
  resolveChromiumPath,
  serveStatic
} from "../tools/browser-harness.mjs";

// A real responsive-browser proof for the public account entry.
//
// Source assertions can confirm that Menu and Sign up exist. They cannot prove
// that responsive CSS leaves either control visible, that the role choices fit
// inside a phone viewport, or that Escape returns focus after the menu closes.
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

  const initial = await browser.evaluate(`
    const toggle = document.querySelector(".menu-toggle");
    const nav = document.querySelector("#main-nav");
    const toggleRect = toggle.getBoundingClientRect();
    return {
      width: window.innerWidth,
      documentWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      toggleDisplay: getComputedStyle(toggle).display,
      toggleWidth: toggleRect.width,
      toggleHeight: toggleRect.height,
      expanded: toggle.getAttribute("aria-expanded"),
      navDisplay: getComputedStyle(nav).display
    };
  `);
  assert(initial.width === 390, `The responsive proof did not receive the requested viewport: ${initial.width}.`);
  assert(initial.scrollWidth === initial.documentWidth, "The landing page overflows horizontally before the mobile menu opens.");
  assert(initial.toggleDisplay !== "none" && initial.toggleWidth >= 44 && initial.toggleHeight >= 44,
    `The mobile Menu control is hidden or smaller than 44px: ${JSON.stringify(initial)}.`);
  assert(initial.expanded === "false" && initial.navDisplay === "none",
    "The collapsed mobile navigation does not start in its closed state.");

  const menuOpen = await browser.evaluate(`
    document.querySelector(".menu-toggle").click();
    const toggle = document.querySelector(".menu-toggle");
    const nav = document.querySelector("#main-nav");
    const summary = document.querySelector("[data-signup-menu] summary");
    const navRect = nav.getBoundingClientRect();
    const summaryRect = summary.getBoundingClientRect();
    return {
      expanded: toggle.getAttribute("aria-expanded"),
      navDisplay: getComputedStyle(nav).display,
      navRect: { left: navRect.left, right: navRect.right, width: navRect.width, height: navRect.height },
      summaryRect: { left: summaryRect.left, right: summaryRect.right, width: summaryRect.width, height: summaryRect.height },
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    };
  `);
  assert(menuOpen.expanded === "true" && menuOpen.navDisplay !== "none",
    "The mobile Menu control does not reveal the account navigation.");
  assert(menuOpen.navRect.left >= 0 && menuOpen.navRect.right <= menuOpen.documentWidth,
    `The mobile account navigation is clipped by the viewport: ${JSON.stringify(menuOpen.navRect)}.`);
  assert(menuOpen.summaryRect.height >= 44 && menuOpen.summaryRect.left >= 0
    && menuOpen.summaryRect.right <= menuOpen.documentWidth,
  `The Sign up control is clipped or smaller than 44px: ${JSON.stringify(menuOpen.summaryRect)}.`);
  assert(menuOpen.scrollWidth === menuOpen.documentWidth,
    "Opening the mobile account navigation creates horizontal page overflow.");

  const choices = await browser.evaluate(`
    const details = document.querySelector("[data-signup-menu]");
    const summary = details.querySelector("summary");
    summary.click();
    const links = [...details.querySelectorAll("a")].map((link) => {
      const rect = link.getBoundingClientRect();
      return {
        href: link.getAttribute("href"),
        text: link.textContent.replace(/\\s+/g, " ").trim(),
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height
      };
    });
    return {
      open: details.open,
      summaryTabIndex: summary.tabIndex,
      links,
      documentWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    };
  `);
  assert(choices.open === true && choices.summaryTabIndex === 0,
    "The Sign up disclosure is not open and keyboard-focusable.");
  assert(choices.links.length === 2
    && choices.links[0].href === "/signup?intent=book"
    && choices.links[1].href === "/signup?intent=work",
  `The Sign up disclosure does not expose the exact two role choices: ${JSON.stringify(choices.links)}.`);
  for (const choice of choices.links) {
    assert(choice.height >= 44 && choice.left >= 0 && choice.right <= choices.documentWidth,
      `A Sign up role choice is clipped or smaller than 44px: ${JSON.stringify(choice)}.`);
  }
  assert(choices.scrollWidth === choices.documentWidth,
    "Opening the Sign up role choices creates horizontal page overflow.");

  const dismissed = await browser.evaluate(`
    const details = document.querySelector("[data-signup-menu]");
    const summary = details.querySelector("summary");
    summary.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return {
      open: details.open,
      focusReturned: document.activeElement === summary
    };
  `);
  assert(dismissed.open === false && dismissed.focusReturned === true,
    "Escape does not close the Sign up disclosure and return focus to its trigger.");

  const menuClosed = await browser.evaluate(`
    const toggle = document.querySelector(".menu-toggle");
    const nav = document.querySelector("#main-nav");
    toggle.click();
    return {
      expanded: toggle.getAttribute("aria-expanded"),
      navDisplay: getComputedStyle(nav).display
    };
  `);
  assert(menuClosed.expanded === "false" && menuClosed.navDisplay === "none",
    "The mobile Menu control cannot close the account navigation again.");
  assert(browser.pageErrors.length === 0,
    `The mobile account entry threw in Chromium: ${browser.pageErrors.join(" | ")}`);
} catch (error) {
  failure = error;
} finally {
  await browser.close();
  await server.close();
}

if (failure) throw failure;
console.log("Browser mobile-entry checks passed: 390px Menu and Sign up interactions, two role choices, 44px targets, no overflow and keyboard dismissal.");

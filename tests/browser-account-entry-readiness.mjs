import { readFile } from "node:fs/promises";
import {
  launchBrowser,
  resolveChromiumPath,
  serveStatic
} from "../tools/browser-harness.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

if (!resolveChromiumPath()) {
  console.log("Browser account-readiness check SKIPPED: no Chromium executable found.");
  process.exit(0);
}

const accountHtml = await readFile(new URL("../public/account.html", import.meta.url), "utf8");
const healthDelayMs = 4_000;
const server = await serveStatic({
  extraFiles: {
    "/login": accountHtml,
    "/api/auth/providers": () => ({
      body: { ok: true, providers: { emailPassword: false, google: true, apple: false, facebook: false } }
    }),
    // This intentionally behaves like a waking free service. Provider
    // capability is authoritative for the button; marketplace health is only
    // needed later when Homle chooses the signed-in workspace destination.
    "/api/health": async () => {
      await new Promise((resolve) => setTimeout(resolve, healthDelayMs));
      return { body: { ok: true, marketplace: { enabled: true, ready: true } } };
    }
  }
});
const browser = await launchBrowser();
let failure = null;

try {
  await browser.setViewport({ width: 390, height: 844 });
  const startedAt = Date.now();
  await browser.goto(`${server.origin}/login`);
  const state = await browser.evaluate(`
    return await new Promise((resolve) => {
      const startedAt = performance.now();
      const inspect = () => {
        const google = document.querySelector('[data-social-provider="google"]');
        const readiness = document.querySelector('[data-account-state-title]');
        const state = {
          googleHidden: google?.hidden,
          googleHref: google?.getAttribute('href'),
          readiness: readiness?.textContent.trim(),
          runtimeHidden: document.querySelector('[data-account-runtime]')?.hidden
        };
        if (state.googleHidden === false || performance.now() - startedAt >= 2_500) return resolve(state);
        setTimeout(inspect, 25);
      };
      inspect();
    });
  `);
  const elapsedMs = Date.now() - startedAt;

  assert(elapsedMs < healthDelayMs - 1_000,
    `Account entry waited ${elapsedMs}ms for a ${healthDelayMs}ms advisory health response before rendering providers.`);
  assert(state.googleHidden === false && state.googleHref === "/api/marketplace/auth/google/start",
    `Google did not become usable from the provider response: ${JSON.stringify(state)}.`);
  assert(state.runtimeHidden === false && state.readiness === "Secure account access is ready.",
    `Account entry did not reach its provider-ready state independently of health: ${JSON.stringify(state)}.`);

  // A visitor can legitimately abandon a booking or Cleaner application and
  // later use the site's generic Log in action. That fresh entry must not
  // inherit the old role intent and silently steer a dual-role account into
  // the wrong workspace.
  await browser.evaluate(`
    const now = Date.now();
    sessionStorage.setItem("tidewayAccountIntentV1", JSON.stringify({
      version: 1,
      intent: "book",
      savedAt: now,
      expiresAt: now + 30 * 60 * 1000
    }));
    return null;
  `);
  await browser.goto(`${server.origin}/login`);
  const neutralEntry = await browser.evaluate(`
    return await new Promise((resolve) => {
      const startedAt = performance.now();
      const inspect = () => {
        const state = {
          title: document.querySelector('[data-account-title]')?.textContent.trim(),
          googleHref: document.querySelector('[data-social-provider="google"]')?.getAttribute('href'),
          storedIntent: sessionStorage.getItem("tidewayAccountIntentV1")
        };
        if (state.title === "Sign in to Homle" || performance.now() - startedAt >= 2_500) return resolve(state);
        setTimeout(inspect, 25);
      };
      inspect();
    });
  `);
  assert(neutralEntry.title === "Sign in to Homle"
      && neutralEntry.googleHref === "/api/marketplace/auth/google/start"
      && neutralEntry.storedIntent === null,
  `Bare login inherited a stale booking intent: ${JSON.stringify(neutralEntry)}.`);

  await browser.goto(`${server.origin}/login?intent=work`);
  const explicitEntry = await browser.evaluate(`return ({
    title: document.querySelector('[data-account-title]')?.textContent.trim(),
    googleHref: document.querySelector('[data-social-provider="google"]')?.getAttribute('href')
  });`);
  assert(explicitEntry.title === "Sign in to work as a Cleaner"
      && explicitEntry.googleHref === "/api/marketplace/auth/google/start?intent=work",
  `Explicit Cleaner intent was not preserved: ${JSON.stringify(explicitEntry)}.`);
  assert(browser.pageErrors.length === 0,
    `The fast account-entry path threw in Chromium: ${browser.pageErrors.join(" | ")}`);
} catch (error) {
  failure = error;
} finally {
  await browser.close();
  await server.close();
}

if (failure) throw failure;
console.log("Browser account-readiness check passed: Google becomes usable before advisory health, bare login clears stale role intent and explicit intent remains authoritative.");

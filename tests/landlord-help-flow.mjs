import { readFile } from "node:fs/promises";
import {
  chromiumExecutableCandidates,
  launchBrowser,
  resolveChromiumPath,
  serveStatic
} from "../tools/browser-harness.mjs";

// Sends a real support request from a tab that has never held a CSRF token.
//
// That starting condition is the whole point. The token lives in
// sessionStorage, which is per-tab, and this page was the only landlord surface
// that read it and gave up when it was empty: it never asked the server for
// one. So a signed-in Landlord who opened Help in a new tab — from a link, a
// bookmark, or a restored session — filled in the entire form, pressed Send and
// was told their "secure editing token is missing" and to sign in again. They
// were already signed in. Nothing was broken except that nobody had asked.
//
// Every assertion below is about the sequence rather than the source text: that
// a token is minted, that it reaches the request as a header, that the payload
// carries what was typed, and that the success state is the one the Landlord
// sees. The support suite already greps this markup; only a browser can show
// that pressing the button sends anything.

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const chromiumPath = resolveChromiumPath();
if (!chromiumPath) {
  console.log(`Landlord help-flow checks SKIPPED: no Chromium executable found. Checked ${chromiumExecutableCandidates().join(", ")}.`);
  process.exit(0);
}

const helpHtml = await readFile(new URL("../public/landlord-help.html", import.meta.url), "utf8");
const json = (value) => JSON.stringify(value);

const posted = [];
let sessionCalls = 0;

/* Statuses and categories come from public/landlord-help-model.js, which
   validates every record and throws on anything it does not recognise — an
   invented status here would fail the history render rather than the page. */
const server = await serveStatic({
  extraFiles: {
    "/landlord/help": helpHtml,
    "/api/marketplace/account": json({ ok: true, account: { roles: ["landlord"], selectedRole: "landlord", displayName: "Help Landlord" } }),
    "/api/marketplace/auth/session": () => {
      sessionCalls += 1;
      return { status: 201, body: { ok: true, csrfToken: "minted-token" } };
    },
    "/api/marketplace/bookings": json({ ok: true, bookings: [] }),
    "/api/marketplace/landlord/support-requests": ({ method, body, headers }) => {
      if (method === "POST") {
        posted.push({ body: JSON.parse(body), csrf: headers["x-csrf-token"] });
        return { status: 201, body: { ok: true } };
      }
      return {
        body: {
          ok: true,
          supportRequests: posted.map((entry, index) => ({
            supportRequestId: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${index}`,
            category: entry.body.category,
            status: "open",
            subject: entry.body.subject,
            description: entry.body.description,
            createdAt: "2026-08-13T12:00:00.000Z",
            resolutionSummary: null,
            bookingChangeKind: null,
            proposedStartAt: null
          }))
        }
      };
    }
  }
});

const browser = await launchBrowser();
let failure = null;

const SUBJECT = "Room scan did not save last night";
const DESCRIPTION = "I walked through three rooms and pressed save, but the request never appeared in my dashboard afterwards.";

try {
  await browser.setViewport({ width: 1440, height: 900, mobile: false });
  await browser.goto(`${server.origin}/landlord/help`);

  const opened = await browser.evaluate(`
    const deadline = Date.now() + 15000;
    for (;;) {
      const workspace = document.querySelector("[data-support-workspace]");
      if (workspace && !workspace.hidden) return true;
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  `);
  assert(opened, "help: the support workspace never opened for a signed-in Landlord.");

  const cleanTab = await browser.evaluate(`sessionStorage.getItem("tideway_csrf") === null`);
  assert(cleanTab, "help: this tab already held a token, so the condition the fix exists for was never exercised.");

  const result = await browser.evaluate(`
    const form = document.querySelector("[data-support-form]");
    const set = (name, value) => {
      const control = form.elements[name];
      control.value = value;
      control.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("category", "room-scan");
    set("subject", ${JSON.stringify(SUBJECT)});
    set("description", ${JSON.stringify(DESCRIPTION)});
    form.elements.confirmNoSensitiveData.checked = true;
    document.querySelector("[data-support-submit]").click();
    const deadline = Date.now() + 15000;
    for (;;) {
      const feedback = document.querySelector("[data-support-form-feedback]");
      if (feedback && !feedback.hidden && feedback.textContent.trim()) {
        return {
          feedback: feedback.textContent.trim(),
          kind: feedback.dataset.kind || "",
          historyCards: document.querySelectorAll("[data-support-list] .support-request-card").length,
          subjectStillTyped: form.elements.subject.value
        };
      }
      if (Date.now() > deadline) return { feedback: "TIMED OUT", kind: "", historyCards: 0, subjectStillTyped: "" };
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  `);

  assert(result.kind === "success",
    `help: sending the form did not succeed — it reported "${result.feedback}".`);
  assert(sessionCalls === 1,
    `help: the page made ${sessionCalls} session calls; a tab with no token must mint exactly one.`);
  assert(posted.length === 1,
    `help: ${posted.length} support requests reached the server for one submission.`);
  assert(posted[0].csrf === "minted-token",
    `help: the request carried "${posted[0].csrf}" instead of the freshly minted token, so the server would reject it.`);
  assert(posted[0].body.subject === SUBJECT && posted[0].body.description === DESCRIPTION,
    "help: the payload did not carry what was typed into the form.");
  assert(posted[0].body.category === "room-scan",
    `help: the payload category is "${posted[0].body.category}" rather than the one selected.`);
  assert(result.historyCards === 1,
    `help: the sent request did not appear in the history — ${result.historyCards} cards rendered.`);
  assert(result.subjectStillTyped === "",
    "help: the form kept its contents after a successful send, inviting an accidental duplicate.");

  /* Navigation. This page used to carry its own two-item header — a third
     navigation pattern inside one signed-in session, after the dashboard's
     sidebar and the Updates page's dark bar. It now renders the shared
     workspace shell, so the destinations here are the same four a Landlord has
     on every other screen, and they come from the signed-in account rather than
     from static markup. */
  const nav = await browser.evaluate(`
    [...document.querySelectorAll(".hw-sidebar .hw-nav a")].map((link) => link.textContent.trim())
  `);
  assert(!nav.includes("Prepare a clean"),
    `help: the header still offers "Prepare a clean" — nav reads [${nav.join(", ")}].`);
  for (const destination of ["Home", "Bookings", "Messages", "Account"]) {
    assert(nav.includes(destination),
      `help: the shared shell lost ${destination} — nav reads [${nav.join(", ")}].`);
  }
  /* Below 900px the sidebar folds away and the tab bar replaces it. Without one
     the page would have no navigation at all on a phone, which is exactly what
     the standalone header shipped. */
  const phoneNav = await browser.evaluate(`
    [...document.querySelectorAll(".hw-mobile-nav a")].map((link) => link.textContent.trim())
  `);
  assert(phoneNav.length >= 4,
    `help: the shared shell rendered no phone tab bar — it reads [${phoneNav.join(", ")}].`);

  /* The restyle, measured rather than eyeballed: the page must resolve to the
     workspace's own ink, canvas and control radius. */
  const look = await browser.evaluate(`
    const body = getComputedStyle(document.body);
    const send = getComputedStyle(document.querySelector("[data-support-submit]"));
    // The page heading and its section label are the shared shell's now, not
    // this page's own header block.
    const eyebrow = getComputedStyle(document.querySelector(".hw-topbar .hw-eyebrow"));
    return {
      background: body.backgroundColor,
      ink: body.color,
      buttonRadius: send.borderTopLeftRadius,
      buttonBackground: send.backgroundColor,
      eyebrowSize: eyebrow.fontSize,
      eyebrowTransform: eyebrow.textTransform
    };
  `);
  assert(look.background === "rgb(247, 246, 245)", `help: the page ground is ${look.background}, not the workspace canvas.`);
  assert(look.ink === "rgb(26, 26, 26)", `help: the page ink is ${look.ink}, not the workspace ink.`);
  assert(look.buttonRadius === "11px", `help: the primary button radius is ${look.buttonRadius}, not the workspace 11px.`);
  assert(look.buttonBackground === "rgb(225, 27, 34)", `help: the primary button is ${look.buttonBackground}, not the workspace coral.`);
  assert(look.eyebrowSize === "11px" && look.eyebrowTransform === "uppercase",
    `help: the section label is ${look.eyebrowSize}/${look.eyebrowTransform}, not the workspace 11px uppercase.`);
} catch (error) {
  failure = error;
} finally {
  await browser.close();
  await server.close();
}

if (failure) throw failure;

console.log("Landlord help-flow tests passed: a tab holding no token mints exactly one, the request carries it, the payload matches what was typed, the history shows the sent request and the form clears, the stale \"Prepare a clean\" route is gone, and the page resolves to the workspace canvas, ink, coral and 11px control radius.");

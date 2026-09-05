// Both sides of a booking conversation are the same thread.
//
// The Cleaner has had a working Messages page for a while and the Landlord had
// a "coming soon" panel, which meant a Cleaner could write to someone who could
// never reply. Nothing was missing from the backend — this checks that the
// Landlord view now exists, talks to the same endpoint, and applies the same
// rules the Cleaner side does.

import { readFile } from "node:fs/promises";
import { launchBrowser, resolveChromiumPath, serveStatic } from "../tools/browser-harness.mjs";
import { activeJobMessagingOpen, mergeBookingMessages } from "../public/active-job-model.js";

function assert(condition, message) { if (!condition) throw new Error(message); }

const [page, landlordMessages, cleanerMessages, dashboard, styles, http, migration] = await Promise.all([
  readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-messages.js", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-messages.js", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard-v2.css", import.meta.url), "utf8"),
  readFile(new URL("../src/marketplace/marketplace-http.mjs", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/015_booking_messaging.sql", import.meta.url), "utf8")
]);

/* ── The placeholder is gone ─────────────────────────────────────────────── */

assert(!page.includes("Messaging is coming soon") && !page.includes("Messaging is not available yet"),
  "The Landlord Messages panel still announces itself as unavailable.");
assert(!page.includes("ld-messages-soon") && !styles.includes("ld-messages-soon"),
  "The placeholder markup or styling is still present.");
// A disabled composer is the specific shape of the old placeholder, and the one
// most likely to survive a careless edit.
assert(!/data-messages-input[^>]*\sdisabled/.test(page),
  "The Landlord composer is disabled, so a Landlord still cannot reply.");

/* ── It talks to the real endpoint ───────────────────────────────────────── */

assert(landlordMessages.includes("/api/marketplace/bookings/${encodeURIComponent(selected)}/messages"),
  "The Landlord view does not read the booking conversation endpoint.");
assert(landlordMessages.includes('method: "POST"') && landlordMessages.includes("clientMessageId"),
  "The Landlord view cannot send, or sends without the idempotency key that makes a retry safe.");
assert(http.includes("bookingMessagesPath") && http.includes("messages.sendMessage") && http.includes("messages.listMessages"),
  "The booking message routes are missing.");

/* ── One definition of a conversation, shared by both sides ──────────────── */

// Two implementations of "which bookings can be talked about" would drift, and
// the two ends of one thread disagreeing is the worst version of that.
for (const [name, source] of [["Landlord", landlordMessages], ["Cleaner", cleanerMessages]]) {
  assert(source.includes("activeJobMessagingOpen"), `${name} messages do not use the shared messaging-open rule.`);
  assert(source.includes("mergeBookingMessages"), `${name} messages do not use the shared page merge.`);
  assert(source.includes("createClientMessageId"), `${name} messages do not use the shared idempotency key.`);
}
assert(landlordMessages.includes('from "./active-job-model.js') && cleanerMessages.includes('from "./active-job-model.js'),
  "The two sides no longer import those rules from the same module.");

// The rule itself: a booking can be talked about exactly while someone is there
// to answer.
assert(activeJobMessagingOpen("confirmed") && activeJobMessagingOpen("cleaning-in-progress") && activeJobMessagingOpen("completed"),
  "A live or just-finished booking cannot be messaged about.");
assert(!activeJobMessagingOpen("cancelled") && !activeJobMessagingOpen("draft"),
  "A cancelled or draft booking offers a conversation that the database would refuse.");

/* ── Each side is filtered to its own bookings ───────────────────────────── */

assert(landlordMessages.includes('participantRole === "landlord"'),
  "The Landlord conversation list is not filtered to the Landlord's own bookings.");
assert(cleanerMessages.includes('participantRole === "cleaner"'),
  "The Cleaner conversation list is not filtered to the Cleaner's own bookings.");

/* ── The reply is attributed by the server, not the client ───────────────── */

assert(landlordMessages.includes('message.senderRole === "landlord"'),
  "The Landlord view does not distinguish its own messages by the server's senderRole.");
// Assignment, not comparison — `senderRole =` is a prefix of `senderRole ===`,
// so the check has to exclude the equality operators explicitly.
assert(!/senderRole\s*:/.test(landlordMessages) && !/senderRole\s*=(?!=)/.test(landlordMessages),
  "The Landlord client assigns senderRole itself instead of trusting the booking's participant ids.");
assert(migration.includes("booking.landlord_user_id=actor_id OR booking.cleaner_user_id=actor_id"),
  "The database no longer restricts a conversation to its two participants.");
assert(migration.includes("'booking-message'"),
  "Sending a message no longer notifies the other participant.");

/* ── A verified response, or nothing ─────────────────────────────────────── */

// Showing a page that came back for a different booking would put one
// booking's private messages inside another's thread.
assert(landlordMessages.includes("result?.bookingId !== bookingId"),
  "The Landlord view renders a message page without checking it is for the open conversation.");

/* ── Merging is stable and ordered ───────────────────────────────────────── */

// Real ids: mergeBookingMessages validates them as UUIDs and drops anything
// else, which is the behaviour that keeps a malformed page out of a thread.
const olderId = "11111111-1111-4111-8111-111111111111";
const newerId = "22222222-2222-4222-8222-222222222222";
const older = [{ messageId: olderId, createdAt: "2026-08-01T10:00:00.000Z", body: "first", senderRole: "cleaner" }];
const newer = [{ messageId: newerId, createdAt: "2026-08-01T10:05:00.000Z", body: "second", senderRole: "landlord" }];
const merged = mergeBookingMessages(older, newer);
assert(merged.length === 2 && merged[0].messageId === olderId && merged[1].messageId === newerId,
  "Merging an earlier page with the current one does not preserve order.");
// And a malformed record never reaches the thread.
assert(mergeBookingMessages(merged, [{ messageId: "not-a-uuid", createdAt: "2026-08-01T10:06:00.000Z", body: "x", senderRole: "landlord" }]).length === 2,
  "A message with an invalid id was accepted into the thread.");
const deduped = mergeBookingMessages(merged, [...newer]);
assert(deduped.length === 2, "The same message arriving twice is shown twice.");

/* ── Loaded on demand, and failing softly ────────────────────────────────── */

assert(dashboard.includes('if (selected === "messages") void openMessages();'),
  "Opening the Messages view does not load the conversation client.");
assert(dashboard.includes('import("./landlord-messages.js') && dashboard.includes(".catch("),
  "The Messages client is eagerly loaded, or a failed load is unhandled.");
assert(dashboard.includes('panel?.setAttribute("aria-busy", "true")')
  && dashboard.includes('panel?.removeAttribute("aria-busy")')
  && dashboard.includes("sequence === landlordMessagesOpenSequence"),
"The Messages view does not expose a race-safe busy lifecycle while its private conversation is loading.");

/* ── The composer keeps the text when a send fails ───────────────────────── */

const sendBody = landlordMessages.slice(landlordMessages.indexOf("async function send("), landlordMessages.indexOf("/* ── Entry"));
assert(sendBody.indexOf('input.value = ""') > sendBody.indexOf("await deps.requestJson"),
  "The composer is cleared before the server confirms, so a failed send loses what was written.");

console.log("Landlord messages UI tests passed: the placeholder is gone, both sides read and write the same booking endpoint through one shared definition of a conversation, attribution comes from the server, message pages are verified against the open conversation, and a failed send keeps the text.");

if (resolveChromiumPath()) {
  const panel = page.match(/<section id="landlord-panel-messages"[\s\S]*?<\/section>/)?.[0];
  assert(panel, "The actual Messages panel could not be found");
  const server = await serveStatic({ extraFiles: { "/message-retry-test.html": `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/landlord-dashboard-v2.css"></head><body>${panel.replace('aria-labelledby="landlord-messages-title" hidden', 'aria-labelledby="landlord-messages-title"')}</body></html>` } });
  const browser = await launchBrowser();
  try {
    for (const width of [390, 1280]) {
      await browser.setViewport({ width, height: 844, mobile: width === 390 });
      await browser.goto(`${server.origin}/message-retry-test.html`);
      await browser.evaluate(`
        const { openLandlordMessages } = await import('/landlord-messages.js');
        const bookingId = '55555555-5555-4555-8555-555555555555';
        window.messageProof = { saved: new Map(), attempts: [], loseResponse: true, delay: false };
        await openLandlordMessages({ bookings: [{ bookingId, participantRole: 'landlord', status: 'confirmed', counterpartyName: 'Test Cleaner', scheduledStartAt: '2026-09-10T10:00:00Z' }], requestJson: async (path, options = {}) => {
          if (options.method !== 'POST') return { bookingId, messages: [], hasMore: false };
          const payload = JSON.parse(options.body);
          const proof = window.messageProof;
          proof.attempts.push(payload);
          if (!proof.saved.has(payload.clientMessageId)) proof.saved.set(payload.clientMessageId, {
            messageId: crypto.randomUUID(), bookingId, clientMessageId: payload.clientMessageId,
            body: payload.body, senderRole: 'landlord', createdAt: new Date().toISOString()
          });
          if (proof.loseResponse) { proof.loseResponse = false; throw new TypeError('Connection closed after saving'); }
          if (proof.delay) await new Promise(resolve => { proof.finishSend = resolve; });
          return { message: proof.saved.get(payload.clientMessageId) };
        } });
        document.querySelector('[data-messages-input]').value = 'Please start with the kitchen.';
        document.querySelector('[data-messages-form]').requestSubmit();
        return null;
      `);
      await browser.evaluate(`
        const deadline = Date.now() + 3000;
        while (document.querySelector('[data-messages-feedback]').hidden) {
          if (Date.now() > deadline) throw new Error('Missing send-failure feedback');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        return null;
      `);
      assert(await browser.evaluate(`document.querySelector('[data-messages-input]').value === 'Please start with the kitchen.'`), "Lost response discarded the message text");
      await browser.evaluate(`document.querySelector('[data-messages-form]').requestSubmit(); await new Promise(resolve => setTimeout(resolve, 100)); return null;`);
      const retry = await browser.evaluate(`return { saved: messageProof.saved.size, attempts: messageProof.attempts, shown: document.querySelectorAll('.ld-message').length, input: document.querySelector('[data-messages-input]').value };`);
      assert(retry.saved === 1 && retry.attempts.length === 2 && retry.attempts[0].clientMessageId === retry.attempts[1].clientMessageId, "Retry after a lost response created a duplicate message");
      assert(retry.shown === 1 && retry.input === '', "Confirmed retry failed to reconcile the original message");
      await browser.evaluate(`
        messageProof.delay = true;
        const form = document.querySelector('[data-messages-form]');
        document.querySelector('[data-messages-input]').value = 'Please start with the kitchen.';
        form.requestSubmit(); form.requestSubmit();
        document.querySelector('[data-messages-input]').value = 'Then please clean the hallway.';
        return null;
      `);
      const pending = await browser.evaluate(`return { attempts: messageProof.attempts.length, disabled: document.querySelector('[data-messages-form] button').disabled };`);
      assert(pending.attempts === 3 && pending.disabled, "Repeated submits were not locked while delivery was pending");
      await browser.evaluate(`messageProof.finishSend(); await new Promise(resolve => setTimeout(resolve, 100)); return null;`);
      const settled = await browser.evaluate(`return { input: document.querySelector('[data-messages-input]').value, saved: messageProof.saved.size, attempts: messageProof.attempts, disabled: document.querySelector('[data-messages-form] button').disabled };`);
      assert(settled.input === 'Then please clean the hallway.' && !settled.disabled, "Acknowledgement erased text typed during the send or left Send locked");
      assert(settled.saved === 2 && settled.attempts[2].clientMessageId !== settled.attempts[1].clientMessageId, "A deliberately repeated message reused a completed send ID");
    }
    assert(browser.pageErrors.length === 0, browser.pageErrors.join('\n'));
  } finally { await browser.close(); await server.close(); }
  console.log("Landlord message browser proof passed at 390px and 1280px: lost-response retry deduplicates, repeated sends serialize, deliberate repeats get new IDs and in-flight typing survives.");
} else console.log("Landlord message browser proof SKIPPED: Chromium unavailable.");

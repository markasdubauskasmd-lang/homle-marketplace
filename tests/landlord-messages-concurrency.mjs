/*
 * Opening the Landlord Messages view twice at once.
 *
 * `landlord-dashboard.js` clears the Messages panel's `aria-busy` when
 * `openLandlordMessages` resolves, and `loadWorkspace` can refresh the bookings
 * while a first open is still fetching its thread — so two opens overlap
 * routinely, not exceptionally.
 *
 * `selectConversation` used to begin `if (!selected || state.loadingBookingId
 * || state.sending) return;`. The second open therefore resolved INSTANTLY
 * while the first was still in flight, and the panel announced a settled
 * Messages view whose thread had not arrived: `aria-busy` came off, the reader
 * (and assistive technology) was told the view was ready, and the content then
 * changed underneath. It surfaced first as a flake in
 * tests/landlord-computed-styles.mjs — the failed-conversation banner rendered
 * in some runs and not others, on whichever viewport lost the race, with three
 * identical runs disagreeing.
 *
 * This EXECUTES the real module against a controlled network, because the whole
 * defect is in the timing: no source-text assertion can see whether a promise
 * resolves too early.
 */
import assert from "node:assert/strict";

/* ── Just enough page for the module ──
 *
 * `landlord-messages.js` touches `document` only inside functions, and every
 * renderer returns early when its element is absent. A querySelector that
 * answers null therefore leaves the rendering inert and the load sequencing —
 * the thing under test — fully live. */
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ className: "", textContent: "", append() {}, replaceChildren() {}, setAttribute() {}, addEventListener() {}, dataset: {} })
};

const { openLandlordMessages } = await import("../public/landlord-messages.js");

const BOOKING_ID = "77777777-7777-4777-8777-777777777777";
const bookings = [{
  bookingId: BOOKING_ID,
  participantRole: "landlord",
  status: "confirmed",
  counterpartyName: "Assigned Cleaner",
  propertyName: "House in London",
  cleaningType: "regular-domestic",
  scheduledStartAt: "2099-08-20T09:00:00.000Z"
}];

/** Resolves to true only if `promise` has settled after the event loop drains. */
async function hasSettled(promise) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  // A macrotask, so every already-resolved microtask chain has run.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return settled;
}

/* ── A second open must not report ready while the first is still fetching ── */

let releaseThread;
let requests = 0;
const requestJson = () => {
  requests += 1;
  return new Promise((resolve) => { releaseThread = () => resolve({ ok: true, messages: [], hasMore: false, nextCursor: null }); });
};

const first = openLandlordMessages({ requestJson, bookings, selectBookingId: BOOKING_ID });
// Let the first open reach its fetch.
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(requests, 1, "The first open did not start a thread load, so this test would prove nothing about what happens while one is in flight.");

const second = openLandlordMessages({ requestJson, bookings, selectBookingId: BOOKING_ID });

assert.equal(
  await hasSettled(second),
  false,
  "A second open of the Messages view resolved while the first was still fetching its thread. The dashboard clears the panel's aria-busy when this resolves, so the view announces itself ready and then changes under the reader."
);
assert.equal(await hasSettled(first), false, "The first open resolved before its own thread load finished.");
assert.equal(requests, 1, "The overlapping open started a SECOND identical thread load rather than waiting for the one already in flight.");

releaseThread();
await Promise.all([first, second]);
assert.equal(await hasSettled(second), true, "The second open never resolved once the thread arrived, so the Messages panel would stay aria-busy forever.");

/* ── A failed thread must settle both opens too ──
 *
 * The failure path is the one the computed-style baseline was measuring, and a
 * rejection that left an open pending would hang the panel rather than show the
 * banner. */

let rejectThread;
requests = 0;
const failing = () => {
  requests += 1;
  return new Promise((resolve, reject) => { rejectThread = () => reject(new Error("The private booking conversation could not be verified.")); });
};

const OTHER_ID = "88888888-8888-4888-8888-888888888888";
const otherBookings = [{ ...bookings[0], bookingId: OTHER_ID }];
const firstFail = openLandlordMessages({ requestJson: failing, bookings: otherBookings, selectBookingId: OTHER_ID });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(requests, 1, "The failing-thread case did not start a load.");
const secondFail = openLandlordMessages({ requestJson: failing, bookings: otherBookings, selectBookingId: OTHER_ID });
assert.equal(await hasSettled(secondFail), false, "An overlapping open resolved while a thread load that was about to fail was still in flight.");

rejectThread();
await Promise.all([firstFail, secondFail]);
assert.equal(await hasSettled(firstFail), true, "A failed thread load left the first open pending, so the Messages panel would stay aria-busy after an error.");
assert.equal(await hasSettled(secondFail), true, "A failed thread load left an overlapping open pending, so the Messages panel would stay aria-busy after an error.");

console.log("Landlord Messages concurrency tests passed: an overlapping open waits for the thread load already in flight rather than reporting a settled view, starts no duplicate request, and both opens settle whether the thread arrives or fails.");

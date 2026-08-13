// The Landlord side of a booking conversation.
//
// The Cleaner has had a working Messages page for a while; the Landlord had a
// "coming soon" panel. Nothing was missing from the backend — migration 015
// checks `landlord_user_id = actor OR cleaner_user_id = actor`, message-service
// accepts either role, and sending already writes a `booking-message`
// notification to whichever participant did not send it. Only this view was
// absent, so a Cleaner could write to a Landlord who could never reply.
//
// This is deliberately the same shape as cleaner-messages.js and reuses the same
// helpers from active-job-model.js — `activeJobMessagingOpen` decides which
// bookings can be talked about, `mergeBookingMessages` merges pages, and
// `createClientMessageId` makes a send idempotent. Two implementations of "what
// is a conversation" would drift, and the two sides of one thread disagreeing
// about which messages exist is the worst version of that.
//
// A conversation exists per BOOKING, not per request or per property. That is
// the only point at which the two people are actually connected: before a
// Cleaner accepts there is nobody to talk to, and after a booking closes the
// database stops accepting messages on it.

import { activeJobMessagingOpen, createClientMessageId, mergeBookingMessages } from "./active-job-model.js?v=20260728-1";

const state = {
  conversations: [],
  messages: new Map(),
  cursors: new Map(),
  selectedBookingId: "",
  loadingBookingId: "",
  sending: false,
  loaded: false
};

let deps = null;

// One owner for the empty-Messages sentence. The list, the reading pane and the
// markup each carried their own wording, so a Landlord with no conversations
// read three different explanations of the same state on one screen. This is
// the wording the markup ships, so the panel says the same thing before the
// module loads as it does after.
const MESSAGES_EMPTY_COPY = "Your conversations appear here once a Cleaner accepts a booking.";

function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function query(selector) {
  return document.querySelector(selector);
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function safeBookingId(value) {
  const candidate = String(value || "").trim().toLowerCase();
  return uuidPattern.test(candidate) ? candidate : "";
}

function initial(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "C";
}

/** Who the Landlord is talking to, and about which property. */
function conversationName(booking) {
  const name = String(booking?.counterpartyName || "").trim();
  // "Assigned Cleaner" is the server's placeholder for an unnamed cleaner. It is
  // a truthful label here rather than an invented person.
  return name || "Assigned Cleaner";
}

function conversationMeta(booking) {
  return [booking?.propertyName, booking?.cleaningType].filter(Boolean).join(" · ") || "Booking";
}

function showFeedback(message, kind = "error") {
  const feedback = query("[data-messages-feedback]");
  if (!feedback) return;
  feedback.textContent = message || "";
  feedback.dataset.kind = kind;
  feedback.hidden = !message;
}

/* ── Rendering ───────────────────────────────────────────────────────────── */

function renderConversations() {
  const list = query("[data-messages-list]");
  const empty = query("[data-messages-list-empty]");
  if (!list) return;

  if (!state.conversations.length) {
    list.replaceChildren(empty || element("p", "ld-messages-list-empty", MESSAGES_EMPTY_COPY));
    const node = query("[data-messages-list-empty]");
    if (node) {
      // One condition, one sentence. The list and the reading pane used to word
      // this differently — and the markup shipped a third wording — so an empty
      // Messages view said the same thing three ways at once.
      node.textContent = state.loaded ? MESSAGES_EMPTY_COPY : "Loading your conversations…";
    }
    return;
  }

  list.replaceChildren(...state.conversations.map((conversation) => {
    const button = element("button", `ld-messages-row${conversation.bookingId === state.selectedBookingId ? " is-current" : ""}`);
    button.type = "button";
    button.setAttribute("aria-pressed", String(conversation.bookingId === state.selectedBookingId));
    button.append(element("span", "ld-messages-avatar", initial(conversation.name)));
    const copy = element("span", "ld-messages-row-copy");
    copy.append(element("strong", "", conversation.name), element("small", "", conversationMeta(conversation)));
    button.append(copy);
    button.addEventListener("click", () => { void selectConversation(conversation.bookingId); });
    return button;
  }));
}

function renderThread({ forceBottom = false } = {}) {
  const body = query("[data-messages-body]");
  const head = query("[data-messages-head]");
  const form = query("[data-messages-form]");
  if (!body) return;

  const conversation = state.conversations.find((entry) => entry.bookingId === state.selectedBookingId) || null;
  if (head) head.hidden = !conversation;
  if (form) form.hidden = !conversation;

  if (!conversation) {
    const empty = element("div", "ld-messages-empty");
    empty.append(element("p", "", state.loaded ? MESSAGES_EMPTY_COPY : "Loading…"));
    body.replaceChildren(empty);
    return;
  }

  if (head) {
    query("[data-messages-head-initial]").textContent = initial(conversation.name);
    query("[data-messages-head-name]").textContent = conversation.name;
    query("[data-messages-head-meta]").textContent = conversationMeta(conversation);
    const link = query("[data-messages-head-booking]");
    if (link) link.href = conversation.activeJobAvailable ? `/bookings/${encodeURIComponent(conversation.bookingId)}` : "/landlord/bookings";
  }

  const records = state.messages.get(conversation.bookingId) || [];
  const nodes = [];

  if (state.cursors.get(conversation.bookingId)) {
    const older = element("button", "ld-messages-older", "Load earlier messages");
    older.type = "button";
    older.addEventListener("click", () => { void loadEarlier(); });
    nodes.push(older);
  }

  if (state.loadingBookingId === conversation.bookingId && !records.length) {
    nodes.push(element("p", "ld-messages-status", "Loading messages…"));
  } else if (!records.length) {
    nodes.push(element("p", "ld-messages-status", "No messages yet. Say hello — your Cleaner sees this in their Messages tab."));
  }

  for (const message of records) {
    // senderRole comes from the database, which derives it from the booking's
    // own participant ids. The client never decides who sent what.
    const wrap = element("div", `ld-message${message.senderRole === "landlord" ? " is-mine" : ""}`);
    wrap.append(element("span", "ld-message-body", message.body));
    const stamp = new Date(message.createdAt);
    if (!Number.isNaN(stamp.getTime())) {
      const time = element("time", "ld-message-time", stamp.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
      time.dateTime = stamp.toISOString();
      wrap.append(time);
    }
    nodes.push(wrap);
  }

  body.replaceChildren(...nodes);
  // Only when the caller means "show the newest message". This used to run on
  // every render, so "Load earlier messages" prepended the older page and then
  // threw the reader straight back to the bottom — twice, since the loading
  // render scrolled before the request even fired. Matches cleaner-messages.js.
  if (forceBottom) requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
}

function render(options = {}) {
  renderConversations();
  renderThread(options);
}

/* ── Loading ─────────────────────────────────────────────────────────────── */

function applyPage(bookingId, result, { earlier = false } = {}) {
  // The response must be for the conversation that was asked for. Anything else
  // means a race or a mixed-up reply, and showing it would put one booking's
  // private messages inside another's thread.
  if (result?.bookingId !== bookingId || !Array.isArray(result.messages)) {
    throw new Error("The private booking conversation could not be verified.");
  }
  const current = state.messages.get(bookingId) || [];
  state.messages.set(bookingId, mergeBookingMessages(earlier ? result.messages : current, earlier ? current : result.messages));
  state.cursors.set(bookingId, result.hasMore === true ? result.nextCursor : null);
}

async function selectConversation(bookingId) {
  const selected = safeBookingId(bookingId);
  if (!selected || state.loadingBookingId || state.sending) return;
  state.selectedBookingId = selected;
  showFeedback("");
  render({ forceBottom: true });
  if (state.messages.has(selected)) return;

  state.loadingBookingId = selected;
  render({ forceBottom: true });
  try {
    const result = await deps.requestJson(`/api/marketplace/bookings/${encodeURIComponent(selected)}/messages?limit=100`);
    applyPage(selected, result);
  } catch (error) {
    showFeedback(error.message || "That conversation could not be opened. Try again.");
  } finally {
    state.loadingBookingId = "";
    render({ forceBottom: true });
  }
}

async function loadEarlier() {
  const bookingId = state.selectedBookingId;
  const cursor = state.cursors.get(bookingId);
  if (!bookingId || !cursor || state.loadingBookingId) return;
  state.loadingBookingId = bookingId;
  render();
  try {
    const search = new URLSearchParams({
      limit: "100",
      beforeCreatedAt: cursor.beforeCreatedAt,
      beforeMessageId: cursor.beforeMessageId
    });
    const result = await deps.requestJson(`/api/marketplace/bookings/${encodeURIComponent(bookingId)}/messages?${search}`);
    applyPage(bookingId, result, { earlier: true });
  } catch (error) {
    showFeedback(error.message || "Earlier messages could not be loaded. Try again.");
  } finally {
    state.loadingBookingId = "";
    render();
  }
}

/* ── Sending ─────────────────────────────────────────────────────────────── */

async function send(event) {
  event.preventDefault();
  const input = query("[data-messages-input]");
  const bookingId = state.selectedBookingId;
  const body = String(input?.value || "").trim();
  if (!bookingId || !body || state.sending) return;

  state.sending = true;
  showFeedback("");
  render();
  try {
    const message = await deps.requestJson(`/api/marketplace/bookings/${encodeURIComponent(bookingId)}/messages`, {
      method: "POST",
      body: JSON.stringify({
        body,
        // Idempotent: a retried send after a flaky connection returns the
        // original message rather than posting it twice.
        clientMessageId: createClientMessageId()
      })
    });
    state.messages.set(bookingId, mergeBookingMessages(state.messages.get(bookingId) || [], [message.message || message]));
    // Only cleared once the server has it. A composer that empties on submit
    // and then fails has thrown away what the customer wrote.
    if (input) input.value = "";
  } catch (error) {
    showFeedback(error.message || "The message was not sent. Your text is still here to retry.");
  } finally {
    state.sending = false;
    render({ forceBottom: true });
    query("[data-messages-input]")?.focus();
  }
}

/* ── Entry ───────────────────────────────────────────────────────────────── */

/**
 * Opens the Landlord Messages view.
 *
 * @param options.requestJson   the dashboard's authenticated JSON helper
 * @param options.bookings      the bookings already loaded by the dashboard
 * @param options.selectBookingId  optional conversation to open
 */
export async function openLandlordMessages(options = {}) {
  deps = { requestJson: options.requestJson };
  if (typeof deps.requestJson !== "function") return;

  const bookings = Array.isArray(options.bookings) ? options.bookings : [];
  state.conversations = [...new Map(bookings
    // The same rule the Cleaner side uses, from the same module: a booking can
    // be talked about only while it is live enough for the other person to
    // answer.
    .filter((booking) => booking?.participantRole === "landlord" && activeJobMessagingOpen(booking.status))
    .map((booking) => ({ ...booking, bookingId: safeBookingId(booking.bookingId), name: conversationName(booking) }))
    .filter((booking) => booking.bookingId)
    .map((booking) => [booking.bookingId, booking]))
    .values()]
    .sort((left, right) => Date.parse(right.scheduledStartAt || "") - Date.parse(left.scheduledStartAt || ""));
  state.loaded = true;

  const requested = safeBookingId(options.selectBookingId);
  const wanted = state.conversations.some((entry) => entry.bookingId === requested)
    ? requested
    : state.conversations[0]?.bookingId || "";

  const form = query("[data-messages-form]");
  if (form && !form.dataset.bound) {
    form.dataset.bound = "true";
    form.addEventListener("submit", (event) => { void send(event); });
  }

  render();
  if (wanted && wanted !== state.selectedBookingId) await selectConversation(wanted);
  else if (wanted) render({ forceBottom: true });
}

/** Lets the dashboard refresh the conversation list when bookings change. */
export function landlordMessagesLoaded() {
  return state.loaded;
}

import { activeJobMessagingOpen, createClientMessageId, mergeBookingMessages } from "./active-job-model.js?v=20260728-1";
import { createCleanerPage, element } from "./cleaner-page.js?v=20260729-10";
import { createRequestJson } from "./request-json.js";

const bookingIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const list = document.querySelector("[data-message-conversations]");
const thread = document.querySelector("[data-message-thread]");
const form = document.querySelector("[data-message-form]");
const input = document.querySelector("[data-message-input]");
const submit = document.querySelector("[data-message-submit]");
const recipient = document.querySelector("[data-message-recipient]");
const recipientAvatar = document.querySelector("[data-message-recipient-avatar]");
const context = document.querySelector("[data-message-context]");
const bookingLink = document.querySelector("[data-message-booking-link]");

const state = {
  account: null,
  conversations: [],
  selectedBookingId: "",
  messages: new Map(),
  cursors: new Map(),
  loadingBookingId: "",
  sending: false,
  messageRetry: null
};

const mutationJson = createRequestJson({
  failureMessage: "Your private message could not be sent.",
  timeoutMs: 30_000,
  timeoutMessage: "Sending took longer than expected. Your message may already have arrived; check this conversation before retrying.",
  requireResultOk: true
});

function storedCsrf() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

function saveCsrf(value) {
  try { sessionStorage.setItem("tideway_csrf", value); } catch {}
}

async function csrfToken() {
  const stored = storedCsrf();
  if (stored) return stored;
  const result = await mutationJson("/api/marketplace/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  if (!result.csrfToken) throw new Error("Your secure session could not be refreshed.");
  saveCsrf(result.csrfToken);
  return result.csrfToken;
}

function selectedConversation() {
  return state.conversations.find((conversation) => conversation.bookingId === state.selectedBookingId) || null;
}

function safeBookingId(value) {
  return bookingIdPattern.test(String(value || "")) ? String(value).toLowerCase() : "";
}

function conversationName(booking) {
  const name = typeof booking?.counterpartyName === "string" ? booking.counterpartyName.trim() : "";
  return name || "Booking client";
}

function initial(value) {
  const match = String(value || "").trim().match(/[\p{L}\p{N}]/u);
  return match ? match[0].toLocaleUpperCase("en-GB") : "H";
}

function bookingContext(booking) {
  const parts = [];
  if (booking?.cleaningType) parts.push(booking.cleaningType);
  if (booking?.propertyArea) parts.push(booking.propertyArea);
  const start = new Date(booking?.scheduledStartAt || "");
  if (Number.isFinite(start.getTime())) {
    parts.push(new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(start));
  }
  return parts.join(" · ") || "Private booking conversation";
}

function compactTime(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "";
  const elapsed = Date.now() - date.getTime();
  if (elapsed >= 0 && elapsed < 60 * 60 * 1000) return `${Math.max(1, Math.floor(elapsed / 60_000))}m`;
  if (elapsed >= 0 && elapsed < 24 * 60 * 60 * 1000) return `${Math.max(1, Math.floor(elapsed / 3_600_000))}h`;
  if (elapsed >= 0 && elapsed < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(elapsed / 86_400_000)}d`;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(date);
}

function messageTime(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(date);
}

function lastMessage(bookingId) {
  return (state.messages.get(bookingId) || []).at(-1) || null;
}

function previewCopy(conversation) {
  const message = lastMessage(conversation.bookingId);
  if (message) return message.body.length > 44 ? `${message.body.slice(0, 43)}…` : message.body;
  return bookingContext(conversation);
}

function renderConversation(conversation) {
  const button = element("button", `hc-message-conversation${conversation.bookingId === state.selectedBookingId ? " is-current" : ""}`);
  button.type = "button";
  button.dataset.bookingId = conversation.bookingId;
  button.setAttribute("aria-pressed", String(conversation.bookingId === state.selectedBookingId));
  button.setAttribute("aria-label", `Open conversation with ${conversation.name} for ${bookingContext(conversation)}`);
  const avatar = element("span", "hc-message-avatar", initial(conversation.name));
  avatar.setAttribute("aria-hidden", "true");
  const copy = element("span", "hc-message-conversation-copy");
  copy.append(element("strong", "", conversation.name), element("small", "", previewCopy(conversation)));
  const time = element("time", "", compactTime(lastMessage(conversation.bookingId)?.createdAt || conversation.scheduledStartAt));
  button.append(avatar, copy, time);
  button.addEventListener("click", () => selectConversation(conversation.bookingId));
  return button;
}

function renderConversations() {
  if (!state.conversations.length) {
    const empty = element("div", "hc-message-conversation-empty");
    empty.append(element("strong", "", "No booking conversations yet"), element("p", "", "Messages appear here after a private booking conversation opens."));
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...state.conversations.map(renderConversation));
}

function renderEmptyThread(title, copy) {
  const empty = element("div", "hc-message-thread-empty");
  empty.append(element("strong", "", title), element("p", "", copy));
  thread.replaceChildren(empty);
}

function renderMessages({ forceBottom = false } = {}) {
  const conversation = selectedConversation();
  if (!conversation) {
    recipient.textContent = "No conversation selected";
    recipientAvatar.textContent = "H";
    context.textContent = "Private booking messages";
    bookingLink.hidden = true;
    renderEmptyThread("Your inbox is ready", "Choose an active booking conversation when one becomes available.");
    input.disabled = true;
    submit.disabled = true;
    return;
  }

  recipient.textContent = conversation.name;
  recipientAvatar.textContent = initial(conversation.name);
  context.textContent = bookingContext(conversation);
  bookingLink.href = `/cleaner/jobs/${encodeURIComponent(conversation.bookingId)}`;
  bookingLink.hidden = false;
  input.disabled = state.sending || state.loadingBookingId === conversation.bookingId;
  submit.disabled = input.disabled;

  if (state.loadingBookingId === conversation.bookingId) {
    renderEmptyThread("Loading conversation…", "Only messages for this booking can appear here.");
    return;
  }

  const records = state.messages.get(conversation.bookingId) || [];
  const nodes = [];
  const cursor = state.cursors.get(conversation.bookingId);
  if (cursor) {
    const older = element("button", "hc-message-load-older", "Load earlier messages");
    older.type = "button";
    older.addEventListener("click", loadEarlierMessages);
    nodes.push(older);
  }
  for (const message of records) {
    const article = element("article", `hc-message-bubble${message.senderRole === "cleaner" ? " is-mine" : ""}`);
    article.append(element("p", "", message.body), element("time", "", messageTime(message.createdAt)));
    nodes.push(article);
  }
  if (!records.length) {
    renderEmptyThread("Start this booking conversation", "Use Homle messages so contact details and payments stay private.");
  } else {
    thread.replaceChildren(...nodes);
  }
  if (forceBottom) requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });
}

function applyMessagePage(bookingId, result, { earlier = false } = {}) {
  if (result?.bookingId !== bookingId || !Array.isArray(result.messages)) throw new Error("The private booking conversation could not be verified.");
  const current = state.messages.get(bookingId) || [];
  state.messages.set(bookingId, mergeBookingMessages(earlier ? result.messages : current, earlier ? current : result.messages));
  state.cursors.set(bookingId, result.hasMore === true ? result.nextCursor : null);
}

async function loadMessagePage(bookingId) {
  const result = await mutationJson(`/api/marketplace/bookings/${encodeURIComponent(bookingId)}/messages?limit=100`);
  applyMessagePage(bookingId, result);
}

async function selectConversation(bookingId) {
  if (!safeBookingId(bookingId) || state.loadingBookingId || state.sending) return;
  state.selectedBookingId = bookingId;
  const selectedUrl = new URL(location.href);
  selectedUrl.searchParams.set("bookingId", bookingId);
  history.replaceState(null, "", `${selectedUrl.pathname}${selectedUrl.search}${selectedUrl.hash}`);
  state.messageRetry = null;
  renderConversations();
  if (!state.messages.has(bookingId)) {
    state.loadingBookingId = bookingId;
    renderMessages();
    try {
      await loadMessagePage(bookingId);
    } catch (error) {
      renderEmptyThread("Conversation unavailable", error.message || "This private conversation could not be loaded.");
    } finally {
      state.loadingBookingId = "";
    }
  }
  renderConversations();
  renderMessages({ forceBottom: true });
}

async function loadEarlierMessages() {
  const bookingId = state.selectedBookingId;
  const cursor = state.cursors.get(bookingId);
  if (!bookingId || !cursor || state.loadingBookingId) return;
  state.loadingBookingId = bookingId;
  renderMessages();
  try {
    const query = new URLSearchParams({
      limit: "100",
      beforeCreatedAt: cursor.beforeCreatedAt,
      beforeMessageId: cursor.beforeMessageId
    });
    const result = await mutationJson(`/api/marketplace/bookings/${encodeURIComponent(bookingId)}/messages?${query}`);
    applyMessagePage(bookingId, result, { earlier: true });
  } catch (error) {
    const feedback = document.querySelector("[data-messages-feedback]");
    feedback.textContent = error.message || "Earlier messages could not be loaded. Try again.";
    feedback.className = "hc-feedback hc-feedback-error";
    feedback.hidden = false;
    feedback.focus();
  } finally {
    state.loadingBookingId = "";
    renderMessages();
  }
}

for (const button of document.querySelectorAll("[data-message-quick-reply]")) {
  button.addEventListener("click", () => {
    if (input.disabled) return;
    input.value = button.dataset.messageQuickReply;
    state.messageRetry = null;
    input.focus();
  });
}

input.addEventListener("input", () => {
  if (state.messageRetry && state.messageRetry.body !== input.value.trim()) state.messageRetry = null;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const conversation = selectedConversation();
  if (!conversation || state.sending || !form.reportValidity()) return;
  const body = input.value.trim();
  if (!body) return;
  try {
    if (!state.messageRetry || state.messageRetry.body !== body) {
      state.messageRetry = { body, clientMessageId: createClientMessageId() };
    }
  } catch (error) {
    const feedback = document.querySelector("[data-messages-feedback]");
    feedback.textContent = error.message;
    feedback.className = "hc-feedback hc-feedback-error";
    feedback.hidden = false;
    feedback.focus();
    return;
  }

  state.sending = true;
  renderMessages();
  try {
    const csrf = await csrfToken();
    const result = await mutationJson(`/api/marketplace/bookings/${encodeURIComponent(conversation.bookingId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(state.messageRetry)
    });
    if (result.message?.bookingId !== conversation.bookingId) throw new Error("The sent booking message could not be verified.");
    state.messages.set(conversation.bookingId, mergeBookingMessages(state.messages.get(conversation.bookingId), [result.message]));
    state.messageRetry = null;
    form.reset();
    renderConversations();
    renderMessages({ forceBottom: true });
  } catch (error) {
    const feedback = document.querySelector("[data-messages-feedback]");
    feedback.textContent = error.message || "The message could not be sent. Your text is still here to retry.";
    feedback.className = "hc-feedback hc-feedback-error";
    feedback.hidden = false;
    feedback.focus();
  } finally {
    state.sending = false;
    renderMessages();
  }
});

createCleanerPage("messages", async ({ account, showFeedback, requestJson }) => {
  state.account = account;
  const result = await requestJson("/api/marketplace/bookings?limit=50");
  const conversations = (Array.isArray(result.bookings) ? result.bookings : [])
    .filter((booking) => booking?.participantRole === "cleaner" && activeJobMessagingOpen(booking.status))
    .map((booking) => ({
      ...booking,
      bookingId: safeBookingId(booking.bookingId),
      name: conversationName(booking)
    }))
    .filter((booking) => booking.bookingId);
  state.conversations = [...new Map(conversations.map((conversation) => [conversation.bookingId, conversation])).values()]
    .sort((left, right) => Date.parse(right.scheduledStartAt || "") - Date.parse(left.scheduledStartAt || ""));

  const requested = safeBookingId(new URLSearchParams(location.search).get("bookingId"));
  state.selectedBookingId = state.conversations.some((conversation) => conversation.bookingId === requested)
    ? requested
    : state.conversations[0]?.bookingId || "";
  renderConversations();
  renderMessages();
  if (state.selectedBookingId) {
    try {
      await selectConversation(state.selectedBookingId);
    } catch (error) {
      showFeedback(error.message || "The selected private conversation could not be loaded.", "error");
    }
  }
});

// The landing page's "get a price" form. Three answers (postcode, type of
// clean, rooms) become one coverage check and one estimate from the same
// engine and price list the booking path uses, without an account. The
// visitor's answers are kept in this tab only, so "Book this clean" can carry
// them through sign-in instead of asking twice.
const root = globalThis.document?.querySelector("[data-quick-quote]");
const guestQuoteKey = "homleGuestQuoteV1";

const money = (pence) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: pence % 100 ? 2 : 0 }).format(pence / 100);
const outward = (postcode) => {
  const compact = String(postcode || "").toUpperCase().replace(/\s+/g, "");
  return compact.length > 4 ? compact.slice(0, -3) : compact;
};
const validPostcode = (value) => /^[A-Z]{1,2}\d[A-Z\d]?(\s*\d[A-Z]{2})?$/i.test(String(value || "").trim());

export function roomsFor({ bedrooms = 1, bathrooms = 1, livingRooms = 1, kitchens = 1 } = {}) {
  const rooms = [];
  const add = (roomType, count) => { for (let index = 0; index < count; index += 1) rooms.push({ roomType, items: [] }); };
  add("kitchen", kitchens); add("living-room", livingRooms); add("bedroom", bedrooms); add("bathroom", bathrooms);
  return rooms;
}

function remember(answers) {
  try {
    const value = JSON.stringify({ version: 1, savedAt: Date.now(), area: outward(answers.postcode), serviceType: answers.serviceType, rooms: answers.counts });
    sessionStorage.setItem(guestQuoteKey, value);
    // Email sign-up verifies in a new tab, which has its own sessionStorage.
    // The journey reads and deletes both copies; it ignores either after 30 minutes.
    localStorage.setItem(guestQuoteKey, value);
  } catch { /* storage unavailable: the visitor simply answers again after sign-in */ }
}

async function getJson(url, init) {
  const response = await fetch(url, { credentials: "same-origin", headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}) }, ...init });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

function count(form, name) {
  const value = Number.parseInt(form.elements[name]?.value, 10);
  return Number.isInteger(value) && value >= 0 ? Math.min(value, 10) : 0;
}

if (root) {
  const form = root.querySelector("[data-quote-form]");
  const result = root.querySelector("[data-quote-result]");
  const error = root.querySelector("[data-quote-error]");
  const submit = form.querySelector("[type=submit]");
  const interest = root.querySelector("[data-interest-form]");

  // A service page links here as /?service=deep#quote; preselect that clean.
  const requested = new URLSearchParams(location.search).get("service");
  const preset = requested && form.querySelector(`input[name="serviceType"][value="${CSS.escape(requested)}"]`);
  if (preset) preset.checked = true;

  root.querySelectorAll("[data-stepper]").forEach((stepper) => {
    const input = stepper.querySelector("input");
    stepper.addEventListener("click", (event) => {
      const button = event.target.closest("[data-step]");
      if (!button) return;
      const next = Math.max(Number(input.min || 0), Math.min(Number(input.max || 10), Number(input.value || 0) + Number(button.dataset.step)));
      input.value = String(next);
    });
  });

  const show = (message) => { error.textContent = message; error.hidden = !message; };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    show("");
    const postcode = String(form.elements.postcode.value || "").trim();
    if (!validPostcode(postcode)) {
      form.elements.postcode.setAttribute("aria-invalid", "true");
      show("Enter a UK postcode, such as SW1A 1AA.");
      form.elements.postcode.focus();
      return;
    }
    form.elements.postcode.removeAttribute("aria-invalid");
    const counts = { bedrooms: count(form, "bedrooms"), bathrooms: count(form, "bathrooms"), livingRooms: count(form, "livingRooms"), kitchens: 1 };
    const serviceType = form.elements.serviceType.value || "standard";
    submit.setAttribute("aria-busy", "true"); submit.disabled = true;
    try {
      const [coverage, quote] = await Promise.all([
        getJson(`/api/public/coverage?postcode=${encodeURIComponent(postcode)}`),
        getJson("/api/public/quote", { method: "POST", body: JSON.stringify({ serviceType, frequency: "one-time", rooms: roomsFor(counts) }) })
      ]);
      if (quote.status === 429 || coverage.status === 429) return show("Lots of price checks from this connection. Wait a few minutes and try again.");
      if (!quote.body?.ok) return show(quote.body?.error || "We could not work out a price just now. Try again in a moment.");
      remember({ postcode, serviceType, counts });
      render(result, { quote: quote.body.quote, note: quote.body.note, coverage: coverage.body?.ok ? coverage.body : null });
    } catch {
      show("We could not reach Homle just now. Check your connection and try again.");
    } finally {
      submit.removeAttribute("aria-busy"); submit.disabled = false;
    }
  });

  interest?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = interest.querySelector("[data-interest-status]");
    if (!interest.elements.consent.checked) { status.textContent = "Tick the box so we are allowed to email you."; return; }
    const { status: code } = await getJson("/api/public/launch-interest", { method: "POST", body: JSON.stringify({ postcode: form.elements.postcode.value, email: interest.elements.email.value, consent: true }) }).catch(() => ({ status: 0 }));
    status.textContent = code === 202 ? "Thanks. We will email you once, when a Cleaner covers your area." : "That did not go through. Check the email address and try again.";
  });
}

function render(result, { quote, note, coverage }) {
  const total = result.querySelector("[data-quote-total]");
  const minutes = result.querySelector("[data-quote-time]");
  const area = result.querySelector("[data-quote-area]");
  const book = result.querySelector("[data-quote-book]");
  const notYet = result.querySelector("[data-quote-not-yet]");
  if (quote?.priceable) {
    total.textContent = money(quote.totalPence);
    const hours = Math.round((quote.estimatedMinutes / 60) * 2) / 2;
    minutes.textContent = `About ${hours} ${hours === 1 ? "hour" : "hours"} of cleaning`;
  } else {
    total.textContent = "Needs a quick check";
    minutes.textContent = quote?.reason || "";
  }
  result.querySelector("[data-quote-note]").textContent = note || "";
  const covered = coverage?.covered === true;
  area.textContent = !coverage ? "We could not check your area just now."
    : covered ? `We have a Cleaner covering ${coverage.area}.`
    : `We do not have a Cleaner in ${coverage.area} yet.`;
  book.hidden = !covered || !quote?.priceable;
  notYet.hidden = covered;
  result.hidden = false;
  result.focus();
  // Counted with the existing cookieless funnel (no postcode, no price, no
  // identifier): only that a visitor on the landing page saw a price.
  if (quote?.priceable) import("/funnel.js?v=20260920-1").then(({ recordFunnel }) => recordFunnel("funnel.price.shown", { surface: "landing" })).catch(() => {});
}

// "From" prices on the service choices: a one-bedroom home (kitchen, living
// room, bedroom, bathroom) priced by the same engine against the live list.
async function fillFromPrices() {
  const targets = document.querySelectorAll("[data-from-price]");
  if (!targets.length) return;
  try {
    const [{ body }, { quoteRooms }] = await Promise.all([getJson("/api/public/pricing"), import("/pricing-engine.js")]);
    if (!body?.ok) return;
    for (const target of targets) {
      const quote = quoteRooms({ serviceType: target.dataset.fromPrice, frequency: "one-time", rooms: roomsFor() }, body.config);
      if (quote?.priceable) target.textContent = `From ${money(quote.totalPence)} for a one-bedroom home`;
    }
  } catch { /* the choices still work without a "from" price */ }
}
if (globalThis.document) fillFromPrices();

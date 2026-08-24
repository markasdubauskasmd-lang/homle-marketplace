// The pricing screen.
//
// Every field is generated from the shipped configuration rather than written
// out by hand, so adding a room type or a specialist task to pricing-config.js
// puts a field on this page without anyone remembering to.
//
// The preview is the reason this page is worth building. A price list on its
// own is abstract: an operator raising a room base by 50p cannot tell from the
// number whether they have just made every small booking unprofitable. The
// preview answers that on every keystroke — customer price, cleaner payout,
// processor fee, margin — and says so plainly when a change breaks a floor.
//
// The economics come from the server, not from here. public/pricing-engine.js
// deliberately does not carry the cleaner's share or the margin floors, because
// it is served to customers; this page asks an administrator-only endpoint for
// them instead.

import { bankHolidayCoverageEndsAt, defaultPricingConfig, normalizedPricingConfig } from "./pricing-config.js?v=20260824-1";
import { formatPence } from "./price-animator.js?v=20260808-1";
import { storedCsrf } from "./session-csrf.js";

const gate = document.querySelector("[data-admin-pricing-gate]");
const gateCopy = document.querySelector("[data-admin-pricing-gate-copy]");
const workspace = document.querySelector("[data-admin-pricing-workspace]");
const form = document.querySelector("[data-pricing-form]");
const feedback = document.querySelector("[data-pricing-feedback]");
const figures = document.querySelector("[data-preview-figures]");
const warning = document.querySelector("[data-preview-warning]");
const breakdown = document.querySelector("[data-preview-breakdown]");
const scenarioSelect = document.querySelector("[data-preview-scenario]");

let working = structuredClone(defaultPricingConfig);
let economics = null;

/* ── Sample bookings ─────────────────────────────────────────────────────── */

const task = (...labels) => labels.map((label, index) => ({ code: `t${index}-${label}`, label }));
const twoBed = [
  { roomType: "kitchen", items: task("Worktops", "Hob", "Sink") },
  { roomType: "bathroom", items: task("Toilet", "Shower", "Sink") },
  { roomType: "living-room", items: task("Sofa", "Table", "Floor") },
  { roomType: "bedroom", items: task("Bed", "Wardrobe", "Floor") },
  { roomType: "bedroom", items: task("Bed", "Wardrobe", "Floor") }
];
const scenarios = {
  small: { rooms: [{ roomType: "bedroom", items: task("Bed", "Table", "Wardrobe") }] },
  bedroom5: { rooms: [{ roomType: "bedroom", items: task("Bed", "Table", "Wardrobe", "Desk", "Mirror") }] },
  "two-room": { rooms: [{ roomType: "bedroom", items: task("Bed", "Wardrobe", "Desk", "Mirror") }, { roomType: "bathroom", items: task("Toilet", "Shower", "Sink", "Tiles", "Mirror") }] },
  standard2bed: { rooms: twoBed },
  deep2bed: { serviceType: "deep", rooms: twoBed },
  eot2bed: { serviceType: "end-of-tenancy", rooms: twoBed },
  kitchenPremium: { rooms: [{ roomType: "kitchen", items: [...task("Worktops", "Hob", "Sink"), { code: "oven", label: "Oven" }, { code: "fridge", label: "Fridge" }] }] },
  large: {
    serviceType: "end-of-tenancy",
    rooms: [
      { roomType: "kitchen", items: [...task("Worktops", "Hob", "Sink", "Floor"), { code: "oven", label: "Oven" }] },
      { roomType: "bathroom", items: task("Toilet", "Shower", "Sink", "Tiles") },
      { roomType: "bathroom", items: task("Toilet", "Shower", "Sink") },
      { roomType: "living-room", items: [...task("Sofa", "Table", "Floor"), { code: "carpet-room", label: "Carpet" }] },
      { roomType: "bedroom", items: task("Bed", "Wardrobe", "Floor", "Windows") },
      { roomType: "bedroom", items: task("Bed", "Wardrobe", "Floor") },
      { roomType: "hallway", items: task("Floor") }
    ]
  }
};

/* ── Field building ──────────────────────────────────────────────────────── */

function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * One editable number.
 *
 * `path` is where the value lives in the configuration, so writing a field back
 * never needs a switch statement that can fall out of step with the schema.
 */
function field(host, { path, label, value, suffix = "", min = 0, max = 1000000, step = 1 }) {
  const wrap = element("label", "admin-pricing-field");
  wrap.append(element("span", "admin-pricing-field-label", label));
  const row = element("span", "admin-pricing-field-row");
  if (suffix === "£") row.append(element("span", "admin-pricing-affix", "£"));
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.dataset.path = path;
  // Money is stored in pence and edited in pounds — an operator thinks in
  // pounds, and the config must never hold a float.
  input.value = suffix === "£" ? (value / 100).toFixed(2) : String(value);
  input.dataset.unit = suffix === "£" ? "pounds" : "raw";
  row.append(input);
  if (suffix && suffix !== "£") row.append(element("span", "admin-pricing-affix", suffix));
  wrap.append(row);
  host.append(wrap);
  return input;
}

function setAtPath(target, path, value) {
  const parts = path.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) {
    if (!node[part] || typeof node[part] !== "object") node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

/* ── Promotion codes ──────────────────────────────────────────────────────
   Held apart from `working` because a normalised configuration is frozen, and
   these are the one part of the page that is a LIST an operator adds to and
   removes from rather than a set of numbers they nudge. */

let promotionDrafts = [];

function promotionDraftsFrom(config) {
  return Object.values(config?.promotions ?? {}).map((promotion) => ({ ...promotion }));
}

/** The drafts, back in the shape normalizedPricingConfig validates. */
function promotionsFromDrafts() {
  const promotions = {};
  for (const draft of promotionDrafts) {
    const code = String(draft.code || "").trim().toUpperCase();
    // A half-typed code is not an error an operator should be shouted at for
    // mid-keystroke; it simply is not a promotion yet. The server validates
    // whatever does get sent.
    if (!/^[A-Z0-9]{3,24}$/.test(code)) continue;
    promotions[code] = {
      code,
      label: String(draft.label || `${code} discount`).slice(0, 60),
      kind: draft.kind === "fixed" ? "fixed" : "percentage",
      value: Math.round(Number(draft.value) || 0),
      maximumDiscountPence: Math.round(Number(draft.maximumDiscountPence) || 0),
      minimumSpendPence: Math.round(Number(draft.minimumSpendPence) || 0),
      firstBookingOnly: draft.firstBookingOnly === true,
      expiresAt: String(draft.expiresAt || "")
    };
  }
  return promotions;
}

function renderPromotions() {
  const host = document.querySelector("[data-fields-promotions]");
  if (!host) return;
  host.replaceChildren(...promotionDrafts.map((draft, index) => {
    const card = element("div", "admin-pricing-row admin-pricing-promotion");
    const grid = element("div", "admin-pricing-row-fields");

    const text = (label, key, { maximumLength = 60, placeholder = "" } = {}) => {
      const wrap = element("label", "admin-pricing-field");
      wrap.append(element("span", "admin-pricing-field-label", label));
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = maximumLength;
      input.placeholder = placeholder;
      input.value = String(draft[key] ?? "");
      input.addEventListener("input", () => {
        draft[key] = key === "code" ? input.value.toUpperCase() : input.value;
        if (key === "code") input.value = draft[key];
        schedulePreview();
      });
      wrap.append(input);
      grid.append(wrap);
    };

    const number = (label, key, { pounds = false, min = 0, max = 100000 } = {}) => {
      const wrap = element("label", "admin-pricing-field");
      wrap.append(element("span", "admin-pricing-field-label", label));
      const row = element("span", "admin-pricing-field-row");
      if (pounds) row.append(element("span", "admin-pricing-affix", "£"));
      const input = document.createElement("input");
      input.type = "number";
      input.min = String(pounds ? min / 100 : min);
      input.max = String(pounds ? max / 100 : max);
      input.step = pounds ? "0.01" : "1";
      input.value = pounds ? ((Number(draft[key]) || 0) / 100).toFixed(2) : String(Number(draft[key]) || 0);
      input.addEventListener("input", () => {
        const raw = Number(input.value);
        if (Number.isFinite(raw)) { draft[key] = pounds ? Math.round(raw * 100) : Math.round(raw); schedulePreview(); }
      });
      row.append(input);
      if (!pounds) row.append(element("span", "admin-pricing-affix", "bp"));
      wrap.append(row);
      grid.append(wrap);
    };

    text("Code", "code", { maximumLength: 24, placeholder: "WELCOME20" });
    text("What the customer sees", "label", { placeholder: "Welcome offer" });

    const kindWrap = element("label", "admin-pricing-field");
    kindWrap.append(element("span", "admin-pricing-field-label", "Kind"));
    const kind = document.createElement("select");
    for (const [value, copy] of [["percentage", "Percentage off"], ["fixed", "Fixed amount off"]]) {
      const option = document.createElement("option");
      option.value = value; option.textContent = copy; option.selected = draft.kind === value;
      kind.append(option);
    }
    kind.addEventListener("change", () => { draft.kind = kind.value; renderPromotions(); schedulePreview(); });
    kindWrap.append(kind);
    grid.append(kindWrap);

    // One field read two ways, so a percentage can never be mistaken for pence.
    if (draft.kind === "fixed") number("Amount off", "value", { pounds: true, min: 1, max: 100000 });
    else number("Percentage off", "value", { min: 1, max: 5000 });

    number("Never more than", "maximumDiscountPence", { pounds: true, min: 1, max: 100000 });
    number("Only above", "minimumSpendPence", { pounds: true, min: 0, max: 1000000 });

    const expiryWrap = element("label", "admin-pricing-field");
    expiryWrap.append(element("span", "admin-pricing-field-label", "Expires"));
    const expiry = document.createElement("input");
    expiry.type = "date";
    expiry.value = String(draft.expiresAt || "").slice(0, 10);
    expiry.addEventListener("change", () => {
      // End of the chosen day, not the start of it: an operator setting "expires
      // 31 March" means the code works on the 31st.
      draft.expiresAt = expiry.value ? `${expiry.value}T23:59:59.999Z` : "";
      schedulePreview();
    });
    expiryWrap.append(expiry);
    grid.append(expiryWrap);

    const firstOnly = element("label", "admin-pricing-field admin-pricing-checkbox");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = draft.firstBookingOnly === true;
    box.addEventListener("change", () => { draft.firstBookingOnly = box.checked; schedulePreview(); });
    firstOnly.append(box, element("span", "", "First booking only"));
    grid.append(firstOnly);

    card.append(grid);
    const remove = element("button", "text-button admin-pricing-remove", "Remove this code");
    remove.type = "button";
    remove.addEventListener("click", () => {
      promotionDrafts.splice(index, 1);
      renderPromotions();
      schedulePreview();
    });
    card.append(remove);
    return card;
  }));
}

function buildFields() {
  const core = document.querySelector("[data-fields-core]");
  core.replaceChildren();
  field(core, { path: "customerHourlyRatePence", label: "Customer hourly rate", value: working.customerHourlyRatePence, suffix: "£", min: 5, max: 300, step: 0.5 });
  field(core, { path: "includedItemsPerRoom", label: "Tasks included per room", value: working.includedItemsPerRoom, min: 0, max: 50 });
  field(core, { path: "additionalItemPence", label: "Each additional task", value: working.additionalItemPence, suffix: "£", min: 0, max: 100, step: 0.5 });
  field(core, { path: "additionalItemMinutes", label: "Minutes per additional task", value: working.additionalItemMinutes, suffix: "min", min: 0, max: 120 });
  field(core, { path: "minimumBookingMinutes", label: "Minimum visit", value: working.minimumBookingMinutes, suffix: "min", min: 0, max: 1440, step: 15 });
  field(core, { path: "perSquareMetrePence", label: "Per square metre above a room's expected size", value: working.perSquareMetrePence, suffix: "£", min: 0, max: 20, step: 0.1 });
  field(core, { path: "roundingIncrementPence", label: "Round totals to", value: working.roundingIncrementPence, suffix: "£", min: 0.01, max: 5, step: 0.01 });
  field(core, { path: "maximumCombinedMultiplierBasisPoints", label: "Multiplier ceiling before a quote goes to review", value: working.maximumCombinedMultiplierBasisPoints, suffix: "bp", min: 10000, max: 100000, step: 500 });

  // Condition. Level 5 is absent and must stay absent: it means a person needs
  // to look at the property first, and an operator who could set a multiplier
  // on it could put a number on that.
  const conditions = document.querySelector("[data-fields-condition]");
  if (conditions) {
    conditions.replaceChildren();
    for (const [level, band] of Object.entries(working.conditionLevels)) {
      if (level === "5") continue;
      field(conditions, { path: `conditionLevels.${level}.multiplierBasisPoints`, label: band.label, value: band.multiplierBasisPoints, suffix: "bp", min: 5000, max: 30000, step: 100 });
    }
  }

  // Location. The area LIST is not editable here on purpose — moving a postcode
  // between bands is a decision about coverage, not a rate change, and it wants
  // more thought than a number field on a page of numbers. The multipliers are
  // the lever an operator reaches for.
  const locations = document.querySelector("[data-fields-location]");
  if (locations) {
    locations.replaceChildren();
    for (const [code, band] of Object.entries(working.locationBands)) {
      field(locations, {
        path: `locationBands.${code}.multiplierBasisPoints`,
        label: `${band.label}${band.areas.length ? ` (${band.areas.length} postcode areas)` : " — everywhere else"}`,
        value: band.multiplierBasisPoints, suffix: "bp", min: 5000, max: 30000, step: 100
      });
    }
  }

  // When. Both surcharges reach the cleaner through the ordinary share, which
  // is what makes an awkward slot worth accepting rather than only dearer.
  const timing = document.querySelector("[data-fields-timing]");
  if (timing) {
    timing.replaceChildren();
    // A bank-holiday list that runs out does not fail loudly: Sundays keep
    // their surcharge and Boxing Day quietly stops having one. Nobody notices
    // until a cleaner is asked to work it at the ordinary rate, so the warning
    // arrives a year early rather than on the day.
    const lastCovered = Date.parse(`${bankHolidayCoverageEndsAt}T23:59:59Z`);
    if (Number.isFinite(lastCovered) && lastCovered - Date.now() < 365 * 24 * 3600 * 1000) {
      const notice = element("p", "admin-pricing-notice",
        `Bank holidays are listed to ${bankHolidayCoverageEndsAt}. After that a bank holiday is priced as an ordinary weekday — add the published dates before then.`);
      timing.append(notice);
    }
    working.urgencyBands.forEach((band, index) => {
      field(timing, { path: `urgencyBands.${index}.surchargeBasisPoints`, label: band.label, value: band.surchargeBasisPoints, suffix: "bp", min: 0, max: 10000, step: 100 });
    });
    for (const [code, band] of Object.entries(working.scheduleSurcharges)) {
      field(timing, { path: `scheduleSurcharges.${code}.surchargeBasisPoints`, label: band.label, value: band.surchargeBasisPoints, suffix: "bp", min: 0, max: 10000, step: 100 });
    }
  }

  // Cancellation. The share a cleaner receives is economics, not a price list
  // entry, so it sits with the rest of the commercial figures below.
  const cancellation = document.querySelector("[data-fields-cancellation]");
  if (cancellation) {
    cancellation.replaceChildren();
    working.cancellationBands.forEach((band, index) => {
      const card = element("div", "admin-pricing-row");
      card.append(element("strong", "admin-pricing-row-name", band.label));
      const grid = element("div", "admin-pricing-row-fields");
      field(grid, { path: `cancellationBands.${index}.basisPoints`, label: "Share of booking", value: band.basisPoints, suffix: "bp", min: 0, max: 10000, step: 100 });
      field(grid, { path: `cancellationBands.${index}.maximumPence`, label: "Capped at", value: band.maximumPence, suffix: "£", min: 0, max: 1000, step: 1 });
      card.append(grid);
      cancellation.append(card);
    });
  }

  const rooms = document.querySelector("[data-fields-rooms]");
  rooms.replaceChildren();
  for (const [code, room] of Object.entries(working.rooms)) {
    const card = element("div", "admin-pricing-row");
    card.append(element("strong", "admin-pricing-row-name", room.label));
    const grid = element("div", "admin-pricing-row-fields");
    field(grid, { path: `rooms.${code}.basePence`, label: "Base", value: room.basePence, suffix: "£", min: 0, max: 500, step: 0.5 });
    field(grid, { path: `rooms.${code}.baseMinutes`, label: "Minutes", value: room.baseMinutes, suffix: "min", min: 1, max: 600 });
    field(grid, { path: `rooms.${code}.includedItems`, label: "Included", value: room.includedItems, min: 0, max: 50 });
    card.append(grid);
    rooms.append(card);
  }

  for (const [selector, source, prefix] of [["[data-fields-premium]", working.premiumItems, "premiumItems"], ["[data-fields-addons]", working.addOns, "addOns"]]) {
    const host = document.querySelector(selector);
    host.replaceChildren();
    for (const [code, item] of Object.entries(source)) {
      const card = element("div", "admin-pricing-row");
      card.append(element("strong", "admin-pricing-row-name", item.label));
      const grid = element("div", "admin-pricing-row-fields");
      field(grid, { path: `${prefix}.${code}.pence`, label: "Price", value: item.pence, suffix: "£", min: 0, max: 1000, step: 0.5 });
      field(grid, { path: `${prefix}.${code}.minutes`, label: "Minutes", value: item.minutes, suffix: "min", min: 0, max: 600 });
      card.append(grid);
      host.append(card);
    }
  }

  const services = document.querySelector("[data-fields-services]");
  services.replaceChildren();
  for (const [code, service] of Object.entries(working.serviceTypes)) {
    field(services, { path: `serviceTypes.${code}.multiplierBasisPoints`, label: `${service.label} multiplier`, value: service.multiplierBasisPoints, suffix: "bp", min: 5000, max: 50000, step: 100 });
    field(services, { path: `serviceTypes.${code}.minimumPence`, label: `${service.label} minimum`, value: service.minimumPence, suffix: "£", min: 0, max: 2000, step: 0.5 });
  }
  for (const [rooms_, value] of Object.entries(working.discounts.multiRoomBasisPoints)) {
    field(services, { path: `discounts.multiRoomBasisPoints.${rooms_}`, label: `${rooms_}+ rooms saving`, value, suffix: "bp", min: 0, max: 5000, step: 50 });
  }
  for (const [frequency, value] of Object.entries(working.discounts.recurringBasisPoints)) {
    field(services, { path: `discounts.recurringBasisPoints.${frequency}`, label: `${frequency.replace(/-/g, " ")} saving`, value, suffix: "bp", min: 0, max: 5000, step: 50 });
  }

  renderPromotions();

  const economicsHost = document.querySelector("[data-fields-economics]");
  economicsHost.replaceChildren();
  if (economics) {
    field(economicsHost, { path: "economics.cleanerShareBasisPoints", label: "Cleaner share", value: economics.cleanerShareBasisPoints, suffix: "bp", min: 3000, max: 9500, step: 50 });
    field(economicsHost, { path: "economics.paymentFeeBasisPoints", label: "Processor percentage", value: economics.paymentFeeBasisPoints, suffix: "bp", min: 0, max: 1000, step: 5 });
    field(economicsHost, { path: "economics.paymentFeeFixedPence", label: "Processor fixed fee", value: economics.paymentFeeFixedPence, suffix: "£", min: 0, max: 100, step: 0.01 });
    field(economicsHost, { path: "economics.targetGrossMarginBasisPoints", label: "Margin floor", value: economics.targetGrossMarginBasisPoints, suffix: "bp", min: 0, max: 8000, step: 50 });
    field(economicsHost, { path: "economics.minimumContributionPence", label: "Minimum contribution", value: economics.minimumContributionPence, suffix: "£", min: 0, max: 1000, step: 0.5 });
    field(economicsHost, { path: "economics.cleanerHourlyFloorPence", label: "Cleaner hourly floor", value: economics.cleanerHourlyFloorPence, suffix: "£", min: 0, max: 200, step: 0.5 });
    field(economicsHost, { path: "economics.cancellationCleanerShareBasisPoints", label: "Cleaner share of a cancellation fee", value: economics.cancellationCleanerShareBasisPoints, suffix: "bp", min: 0, max: 10000, step: 100 });
  }
}

/** Reads every field back into a configuration object. */
function collect() {
  // Started from the LOADED configuration, not from the shipped defaults.
  //
  // Only numbers are editable on this page; everything else — the postcode
  // areas in each band, custom room labels, the promotion list — is carried
  // through untouched. Rebuilding from the defaults would silently reset all of
  // it every time an operator changed the hourly rate.
  const next = structuredClone(working);
  // The one part of the page that is a list rather than a number.
  next.promotions = promotionsFromDrafts();
  next.economics = economics ? { ...economics } : undefined;
  for (const input of form.querySelectorAll("input[data-path]")) {
    const raw = Number(input.value);
    if (!Number.isFinite(raw)) continue;
    setAtPath(next, input.dataset.path, input.dataset.unit === "pounds" ? Math.round(raw * 100) : Math.round(raw));
  }
  return next;
}

/* ── Preview ─────────────────────────────────────────────────────────────── */

function showFeedback(message, kind = "info") {
  if (!feedback) return;
  feedback.textContent = message;
  feedback.dataset.kind = kind;
  feedback.hidden = !message;
}

let previewTimer = 0;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(runPreview, 220);
}

async function runPreview() {
  const candidate = collect();
  let config;
  try {
    // Validated here first so an out-of-range edit is named against its own
    // field immediately, rather than coming back as a generic server refusal.
    config = normalizedPricingConfig(candidate);
  } catch (error) {
    warning.hidden = false;
    warning.textContent = error.message;
    figures.replaceChildren();
    return;
  }

  try {
    const result = await request("/api/marketplace/admin/pricing/preview", {
      method: "POST",
      body: JSON.stringify({ config, economics: candidate.economics, request: scenarios[scenarioSelect.value] || scenarios.standard2bed })
    });
    renderPreview(result.quote, result.economics);
  } catch (error) {
    warning.hidden = false;
    warning.textContent = error.message || "The preview could not be worked out.";
  }
}

function renderPreview(quote, quoteEconomics) {
  const healthy = quote?.priceable && quoteEconomics?.healthy;
  warning.hidden = healthy;
  if (!healthy) {
    // The operator sees exactly which floor was broken — this is the page where
    // that detail belongs, and it is the only place it is shown.
    warning.textContent = quoteEconomics?.reason
      ? `This booking would be refused: ${quoteEconomics.reason}.`
      : quote?.reason || "This booking cannot be priced.";
  }
  if (!quote?.priceable) { figures.replaceChildren(); breakdown.replaceChildren(); return; }

  const tiles = [
    { key: "Customer pays", value: formatPence(quoteEconomics.customerPaysPence), tone: "headline" },
    { key: "Cleaner earns", value: formatPence(quoteEconomics.cleanerPayoutPence), note: `${formatPence(quoteEconomics.effectiveCleanerHourlyPence)}/hour` },
    { key: "Processor", value: `−${formatPence(quoteEconomics.paymentFeePence)}` },
    { key: "Gross margin", value: formatPence(quoteEconomics.grossMarginPence), note: `${(quoteEconomics.grossMarginBasisPoints / 100).toFixed(1)}%`, tone: quoteEconomics.healthy ? "good" : "bad" },
    { key: "Cleaning time", value: `${Math.round(quote.estimatedMinutes / 6) / 10} hrs` }
  ];
  figures.replaceChildren(...tiles.map((tile) => {
    const node = element("div", `admin-pricing-figure${tile.tone ? ` is-${tile.tone}` : ""}`);
    node.append(element("span", "admin-pricing-figure-key", tile.key), element("strong", "", tile.value));
    if (tile.note) node.append(element("small", "", tile.note));
    return node;
  }));

  breakdown.replaceChildren(...quote.lines.map((line) => {
    const row = element("li", "");
    row.append(element("span", "", line.label), element("b", "", formatPence(line.pence)));
    return row;
  }));
}

/* ── Server ──────────────────────────────────────────────────────────────── */

async function request(path, init = {}) {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": storedCsrf(), ...(init.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body?.message || "That did not work."), { statusCode: response.status });
  return body;
}

async function load() {
  try {
    const result = await request("/api/marketplace/admin/pricing");
    working = normalizedPricingConfig(result.config || defaultPricingConfig);
    promotionDrafts = promotionDraftsFrom(working);
    economics = result.economics || null;
    gate.hidden = true;
    workspace.hidden = false;
    buildFields();
    await runPreview();
  } catch (error) {
    gate.hidden = false;
    workspace.hidden = true;
    gateCopy.textContent = error.statusCode === 401 || error.statusCode === 403
      ? "Sign in with an administrator account to open pricing."
      : "Pricing could not be loaded. Try again shortly.";
  }
}

form?.addEventListener("input", schedulePreview);
scenarioSelect?.addEventListener("change", runPreview);

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const candidate = collect();
  try {
    normalizedPricingConfig(candidate);
  } catch (error) {
    return showFeedback(error.message, "error");
  }
  const changeReason = document.querySelector("[data-pricing-reason]")?.value?.trim() || "";
  if (changeReason.length < 10) {
    return showFeedback("Say why this is changing — at least a short sentence. It is stored with the version.", "error");
  }
  showFeedback("Saving…");
  try {
    const result = await request("/api/marketplace/admin/pricing", {
      method: "PUT",
      body: JSON.stringify({ config: candidate, economics: candidate.economics, changeReason })
    });
    working = normalizedPricingConfig(result.config);
    promotionDrafts = promotionDraftsFrom(working);
    economics = result.economics || economics;
    showFeedback("Pricing saved. The next quote uses it.", "success");
  } catch (error) {
    showFeedback(error.message || "Pricing was not saved. Nothing changed.", "error");
  }
});

document.querySelector("[data-add-promotion]")?.addEventListener("click", () => {
  // Deliberately blank rather than pre-filled with a plausible offer. A code an
  // operator did not type is a code nobody decided to run.
  promotionDrafts.push({
    code: "", label: "", kind: "percentage",
    value: 1000, maximumDiscountPence: 2000, minimumSpendPence: 0,
    firstBookingOnly: false, expiresAt: ""
  });
  renderPromotions();
  document.querySelector("[data-fields-promotions] .admin-pricing-promotion:last-child input")?.focus();
});

document.querySelector("[data-pricing-reset]")?.addEventListener("click", () => {
  if (!window.confirm("Reset every price back to the shipped defaults? This does not save until you press Save.")) return;
  working = structuredClone(defaultPricingConfig);
  promotionDrafts = promotionDraftsFrom(working);
  buildFields();
  void runPreview();
  showFeedback("Fields reset to the shipped defaults. Nothing is saved until you press Save.");
});

void load();

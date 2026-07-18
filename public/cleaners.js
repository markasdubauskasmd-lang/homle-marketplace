import { accountEntryPath } from "./account-intent.js";

const form = document.querySelector("[data-directory-form]");
const results = document.querySelector("[data-cleaner-results]");
const state = document.querySelector("[data-directory-state]");
const stateTitle = document.querySelector("[data-state-title]");
const stateCopy = document.querySelector("[data-state-copy]");
const resultsTitle = document.querySelector("[data-results-title]");
const resultsCount = document.querySelector("[data-results-count]");
const retry = document.querySelector("[data-retry]");
const stateAction = document.querySelector("[data-state-action]");
const filterError = document.querySelector("[data-filter-error]");
const serviceLabels = new Map([
  ["regular-domestic", "Regular domestic"],
  ["rental-turnovers", "Rental turnover"],
  ["end-of-tenancy", "End of tenancy"],
  ["workplaces", "Workplace"],
  ["communal-areas", "Communal areas"],
  ["deep-cleans", "Deep clean"]
]);
const currency = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
let controller = null;
let landlordFavouriteAccess = false;
let favouriteCleanerIds = new Set();
let favouriteMutationId = "";

function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function showState(kind, title, copy, retryable = false, actionLabel = "") {
  state.dataset.kind = kind;
  state.hidden = false;
  results.hidden = true;
  stateTitle.textContent = title;
  stateCopy.textContent = copy;
  retry.hidden = !retryable;
  stateAction.textContent = actionLabel;
  stateAction.hidden = !actionLabel;
  resultsCount.hidden = true;
}

function listText(items, fallback) {
  return Array.isArray(items) && items.length ? items.join(", ") : fallback;
}

function rateText(cleaner) {
  if (Number.isInteger(cleaner.hourlyRatePence) && cleaner.hourlyRatePence > 0) return `${currency.format(cleaner.hourlyRatePence / 100)} / hour`;
  const priced = Array.isArray(cleaner.services) ? cleaner.services.find((service) => Number.isInteger(service.pricePence) && service.pricePence > 0) : null;
  return priced ? `${currency.format(priced.pricePence / 100)} ${priced.pricingModel}` : "Price agreed from scope";
}

function safePhoto(url, name) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.origin !== location.origin) throw new Error();
    const image = element("img", "directory-cleaner-photo");
    image.src = parsed.toString();
    image.alt = `${name} profile`;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => image.replaceWith(initials(name)));
    return image;
  } catch {
    return initials(name);
  }
}

function initials(name) {
  const value = String(name || "Cleaner").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "C";
  return element("span", "directory-cleaner-photo directory-cleaner-initials", value);
}

function detail(label, value) {
  const item = element("div");
  item.append(element("dt", "", label), element("dd", "", value));
  return item;
}

function saveCsrf(token) {
  try {
    if (token) sessionStorage.setItem("tideway_csrf", token);
    return token && sessionStorage.getItem("tideway_csrf") === token;
  } catch { return false; }
}

async function privateRequestJson(path, options = {}, timeoutMs = 15_000) {
  const privateController = new AbortController();
  const timer = window.setTimeout(() => privateController.abort(), timeoutMs);
  try {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal: privateController.signal, ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok !== true) throw Object.assign(new Error(body.error || "The saved Cleaner list is temporarily unavailable."), { statusCode: response.status });
    return body;
  } catch (error) {
    if (error?.name === "AbortError") throw Object.assign(new Error("Homle could not confirm that change. It may have completed; the saved list will be checked before another change."), { code: "request-timeout" });
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function recoverCsrf() {
  try {
    const current = sessionStorage.getItem("tideway_csrf") || "";
    if (current) return current;
  } catch {}
  const result = await privateRequestJson("/api/marketplace/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!result.csrfToken || !saveCsrf(result.csrfToken)) throw new Error("This tab could not keep the secure account token. Sign in again before saving a Cleaner.");
  return result.csrfToken;
}

async function readFavouriteCleanerIds() {
  const result = await privateRequestJson("/api/marketplace/landlord/favourite-cleaners");
  favouriteCleanerIds = new Set((Array.isArray(result.cleaners) ? result.cleaners : []).map((cleaner) => cleaner.cleanerId));
  return favouriteCleanerIds;
}

function updateFavouriteButton(button, cleanerId) {
  const saved = favouriteCleanerIds.has(cleanerId);
  button.textContent = saved ? "Saved Cleaner" : "Save Cleaner";
  button.setAttribute("aria-pressed", String(saved));
  button.classList.toggle("is-saved", saved);
}

async function setFavourite(cleanerId, button, status) {
  if (favouriteMutationId) return;
  if (navigator.onLine === false) {
    status.textContent = "Reconnect before changing saved Cleaners.";
    return;
  }
  const desired = !favouriteCleanerIds.has(cleanerId);
  favouriteMutationId = cleanerId;
  button.disabled = true;
  status.textContent = desired ? "Saving Cleaner..." : "Removing saved Cleaner...";
  try {
    const csrf = await recoverCsrf();
    const result = await privateRequestJson(`/api/marketplace/landlord/favourite-cleaners/${encodeURIComponent(cleanerId)}`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ favourite: desired }) });
    if (result.favourite?.favourite === true) favouriteCleanerIds.add(cleanerId);
    else favouriteCleanerIds.delete(cleanerId);
    status.textContent = result.favourite?.favourite === true ? "Saved privately to your Landlord dashboard." : "Removed from your saved Cleaners.";
  } catch (error) {
    let reconciled = false;
    try {
      await readFavouriteCleanerIds();
      reconciled = favouriteCleanerIds.has(cleanerId) === desired;
    } catch {}
    status.textContent = reconciled
      ? (desired ? "Saved privately to your Landlord dashboard." : "Removed from your saved Cleaners.")
      : (error?.message || "Homle could not confirm the saved Cleaner change. No change will be retried automatically.");
  } finally {
    favouriteMutationId = "";
    button.disabled = false;
    updateFavouriteButton(button, cleanerId);
  }
}

function favouriteControl(cleaner, name) {
  if (!landlordFavouriteAccess) return null;
  const wrapper = element("div", "directory-favourite-control");
  const button = element("button", "button button-outline directory-favourite-button");
  button.type = "button";
  button.setAttribute("aria-label", `Save ${name} to your Landlord dashboard`);
  updateFavouriteButton(button, cleaner.cleanerId);
  const status = element("small", "directory-favourite-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  button.addEventListener("click", () => setFavourite(cleaner.cleanerId, button, status));
  wrapper.append(button, status);
  return wrapper;
}

function cleanerCard(cleaner) {
  const card = element("article", "directory-cleaner-card");
  const identity = element("div", "directory-cleaner-identity");
  const name = String(cleaner.displayName || "Cleaner profile");
  const heading = element("div");
  const availability = element("span", `directory-availability is-${cleaner.currentAvailabilityStatus || "unavailable"}`, cleaner.currentAvailabilityStatus === "available" ? "Available" : cleaner.currentAvailabilityStatus === "limited" ? "Limited availability" : "Availability not open");
  heading.append(availability, element("h3", "", name));
  const evidence = [];
  if (cleaner.verified === true) evidence.push("Verified evidence recorded");
  if (Number(cleaner.completedJobCount) > 0) evidence.push(`${Number(cleaner.completedJobCount)} completed ${Number(cleaner.completedJobCount) === 1 ? "job" : "jobs"}`);
  heading.append(element("p", "", evidence.join(" · ") || "New public profile"));
  identity.append(safePhoto(cleaner.profilePhotoUrl, name), heading);

  const metrics = element("div", "directory-cleaner-metrics");
  const rating = Number(cleaner.reviewCount) > 0 ? `${Number(cleaner.averageRating).toFixed(1)} ★ (${Number(cleaner.reviewCount)})` : "No completed-job reviews yet";
  metrics.append(detail("Rating", rating), detail("Price", rateText(cleaner)), detail("Travel", cleaner.distanceKm == null ? `Up to ${Number(cleaner.travelRadiusKm) || 0} km` : `${Number(cleaner.distanceKm).toFixed(1)} km away`));

  const biography = element("p", "directory-cleaner-bio", String(cleaner.biography || "This Cleaner has not added an introduction."));
  const chips = element("div", "profile-chips");
  for (const service of Array.isArray(cleaner.services) ? cleaner.services : []) chips.append(element("span", "", serviceLabels.get(service.serviceCode) || service.serviceCode));

  const details = element("details", "directory-cleaner-details");
  const summary = element("summary", "", "View profile details");
  const facts = element("dl", "directory-profile-facts");
  facts.append(
    detail("Experience", cleaner.yearsExperience == null ? "Not supplied" : `${cleaner.yearsExperience} ${cleaner.yearsExperience === 1 ? "year" : "years"}`),
    detail("Languages", listText(cleaner.languages, "Not supplied")),
    detail("Equipment", listText(cleaner.equipmentSupplied, "Not supplied")),
    detail("Products", listText(cleaner.productsSupplied, "Not supplied")),
    detail("Preferred work", [cleaner.residentialPreference ? "Residential" : "", cleaner.commercialPreference ? "Commercial" : ""].filter(Boolean).join(" and ") || "Not supplied")
  );
  const boundary = element("p", "directory-profile-boundary", "Requesting a Cleaner does not confirm a booking. Homle must recheck the room checklist, date, price and availability.");
  details.append(summary, facts, boundary);
  const requestLink = element("a", "button directory-cleaner-action", "Start a cleaning request");
  requestLink.href = accountEntryPath("book", cleaner.cleanerId);
  requestLink.setAttribute("aria-label", `Start a cleaning request with ${name}`);
  const actions = element("div", "directory-cleaner-actions");
  actions.append(requestLink);
  const favourite = favouriteControl(cleaner, name);
  if (favourite) actions.append(favourite);
  card.append(identity, metrics, biography, chips, details, actions);
  return card;
}

function searchParameters() {
  const data = new FormData(form);
  const params = new URLSearchParams({ limit: "20" });
  const outwardPostcode = String(data.get("outwardPostcode") || "").trim().toUpperCase().replace(/\s/g, "");
  if (outwardPostcode && !/^[A-Z]{1,2}[0-9][A-Z0-9]?$/.test(outwardPostcode)) throw new TypeError("Enter a valid UK outward postcode, for example SW2.");
  if (outwardPostcode) params.set("outwardPostcode", outwardPostcode);
  const serviceCode = String(data.get("serviceCode") || "");
  if (serviceCode) params.set("serviceCode", serviceCode);
  const minimumRating = String(data.get("minimumRating") || "");
  if (minimumRating) params.set("minimumRating", minimumRating);
  const maximumPrice = String(data.get("maximumPrice") || "");
  if (maximumPrice) {
    const amount = Number(maximumPrice);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) throw new TypeError("Maximum price must be between £1 and £10,000.");
    params.set("maximumPricePence", String(Math.round(amount * 100)));
  }
  if (data.get("verifiedOnly") === "on") params.set("verifiedOnly", "true");
  const date = String(data.get("date") || "");
  const startTime = String(data.get("startTime") || "");
  const endTime = String(data.get("endTime") || "");
  if (date || startTime || endTime) {
    if (!date || !startTime || !endTime) throw new TypeError("Choose the date, start time and end time to filter availability.");
    const start = new Date(`${date}T${startTime}`);
    const end = new Date(`${date}T${endTime}`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new TypeError("Availability end time must be after the start time.");
    params.set("startAt", start.toISOString());
    params.set("endAt", end.toISOString());
  }
  return params;
}

async function loadDirectory() {
  filterError.hidden = true;
  let params;
  try { params = searchParameters(); } catch (error) {
    filterError.textContent = error.message;
    filterError.hidden = false;
    filterError.focus?.();
    return;
  }
  controller?.abort();
  controller = new AbortController();
  showState("loading", "Searching public profiles…", "Only complete profiles that match these filters will be shown.");
  resultsTitle.textContent = "Searching Cleaners…";
  try {
    const response = await fetch(`/api/marketplace/cleaners?${params}`, { headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 404 || response.status === 503) {
        showState("unavailable", "Cleaner accounts are not open yet.", "The guided cleaning request is still available. Tell Homle about the property now and public profiles will appear here after the secure marketplace is connected.", true, "Request a clean instead");
        resultsTitle.textContent = "Marketplace not connected";
        return;
      }
      throw new Error(body.message || "Cleaner search could not be completed.");
    }
    const cleaners = Array.isArray(body.cleaners) ? body.cleaners : [];
    results.replaceChildren(...cleaners.map(cleanerCard));
    resultsTitle.textContent = cleaners.length ? "Matching Cleaner profiles" : "No matching profiles yet";
    resultsCount.textContent = `${cleaners.length} ${cleaners.length === 1 ? "profile" : "profiles"}`;
    resultsCount.hidden = false;
    if (!cleaners.length) {
      showState("empty", "No public profiles match these filters.", "Try different filters, or send Homle the property details so the request can be reviewed.", false, "Request guided matching");
      resultsCount.hidden = false;
      return;
    }
    state.hidden = true;
    results.hidden = false;
  } catch (error) {
    if (error.name === "AbortError") return;
    showState("error", "Cleaner search is temporarily unavailable.", "No booking was created. Try the search again or continue with Homle's guided cleaning request.", true, "Request a clean instead");
    resultsTitle.textContent = "Search interrupted";
  }
}

form.addEventListener("submit", (event) => { event.preventDefault(); loadDirectory(); });
form.addEventListener("reset", () => setTimeout(() => {
  const advanced = document.querySelector("[data-directory-advanced]");
  if (advanced) advanced.open = false;
  loadDirectory();
}));
retry.addEventListener("click", loadDirectory);
document.querySelector("[data-year]").textContent = new Date().getFullYear();

async function initializeDirectory() {
  try {
    const accountResult = await privateRequestJson("/api/marketplace/account");
    landlordFavouriteAccess = accountResult.account?.selectedRole === "landlord" && accountResult.account?.roles?.includes("landlord");
    if (landlordFavouriteAccess) await readFavouriteCleanerIds();
  } catch {
    landlordFavouriteAccess = false;
    favouriteCleanerIds = new Set();
  }
  await loadDirectory();
}

initializeDirectory();

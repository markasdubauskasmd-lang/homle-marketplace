import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260729-6";
import { storedCsrf } from "./session-csrf.js";

const outwardPostcodePattern = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;
const svgNamespace = "http://www.w3.org/2000/svg";
const milesPerKilometre = 0.621371;
let areas = [];
let profile = null;
let travelRadiusMiles = 15;
let mapZoom = 1;

function renderRail(progress) {
  const steps = new Map(progress.steps.map((step) => [step.key, step]));
  document.querySelectorAll("[data-personal-step-key]").forEach((node) => {
    const key = node.dataset.personalStepKey;
    node.classList.toggle("is-current", key === "areas");
    node.classList.toggle("is-complete", steps.get(key)?.done === true);
  });
}

function element(tag, className = "", copy = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (copy) node.textContent = copy;
  return node;
}

function svgElement(tag, attributes = {}) {
  const node = document.createElementNS(svgNamespace, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

function normalizedOutwardPostcode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s/g, "");
}

function mapPoint(area) {
  let x;
  let y;
  if (Number.isFinite(area.longitude) && Number.isFinite(area.latitude)) {
    x = (area.longitude + 8.5) / 11 * 600;
    y = (59 - area.latitude) / 9.5 * 680;
  } else {
    const hash = [...area.outwardPostcode].reduce((value, character) => value * 31 + character.charCodeAt(0), 17);
    x = 110 + Math.abs(hash % 380);
    y = 130 + Math.abs(Math.floor(hash / 11) % 410);
  }
  x = (x - 300) * mapZoom + 300;
  y = (y - 340) * mapZoom + 340;
  return { x: Math.max(36, Math.min(564, x)), y: Math.max(36, Math.min(644, y)) };
}

function updateRadiusCopy() {
  document.querySelector("[data-work-radius-output]").textContent = `${travelRadiusMiles} miles`;
}

function renderMap() {
  const host = document.querySelector("[data-work-map-markers]");
  if (!host) return;
  const markers = areas.filter((area) => area.role === "primary").map((area) => {
    const point = mapPoint(area);
    const group = svgElement("g");
    group.append(
      svgElement("circle", { class: "hc-work-map-marker-radius", cx: point.x, cy: point.y, r: Math.min(86, 17 + travelRadiusMiles * 2.2) }),
      svgElement("circle", { class: "hc-work-map-marker", cx: point.x, cy: point.y, r: 11 })
    );
    const label = svgElement("text", { class: "hc-work-map-label", x: point.x + 16, y: point.y - 15 });
    label.textContent = area.outwardPostcode;
    group.append(label);
    return group;
  });
  host.replaceChildren(...markers);
}

function renderAreas() {
  const list = document.querySelector("[data-work-list]");
  const empty = document.querySelector("[data-work-empty]");
  const base = document.querySelector("[data-work-base]");
  if (!list || !empty || !base) return;
  base.textContent = areas.find((area) => area.role === "primary")?.outwardPostcode || "Not set";
  list.replaceChildren(...areas.map((area) => {
    const card = element("article", "hc-work-area-card");
    const title = element("strong", "hc-work-area-title", area.outwardPostcode);
    const select = element("select");
    select.setAttribute("aria-label", `Treatment for ${area.outwardPostcode}`);
    for (const [value, copy] of [["primary", "Primary"], ["secondary", "Secondary"], ["excluded", "Excluded"]]) {
      const option = element("option", "", copy);
      option.value = value;
      option.selected = area.role === value;
      select.append(option);
    }
    select.addEventListener("change", () => {
      area.role = select.value;
      renderAreas();
      const status = document.querySelector("[data-work-save-status]");
      if (status) status.textContent = area.role === "primary"
        ? "Primary areas can be saved for matching."
        : "Secondary and excluded labels are preview-only and cannot be saved yet.";
    });
    const remove = element("button", "hc-work-area-remove", "Remove");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${area.outwardPostcode}`);
    remove.addEventListener("click", () => {
      areas = areas.filter((candidate) => candidate !== area);
      renderAreas();
    });
    const copy = element("span", "hc-work-area-copy");
    copy.append(
      element("span", "", area.latitude == null ? "Coordinates resolve securely when saved" : "Postcode coordinates stored"),
      remove
    );
    const radius = element("label", "hc-work-area-radius");
    const radiusOutput = element("output", "", `${travelRadiusMiles} miles`);
    const radiusInput = element("input");
    radiusInput.type = "range";
    radiusInput.min = "1";
    radiusInput.max = "50";
    radiusInput.value = String(travelRadiusMiles);
    radiusInput.setAttribute("aria-label", `Profile travel radius from ${area.outwardPostcode}`);
    radiusInput.addEventListener("input", () => {
      travelRadiusMiles = Number(radiusInput.value);
      const globalRadius = document.querySelector("[data-work-radius]");
      if (globalRadius instanceof HTMLInputElement) globalRadius.value = String(travelRadiusMiles);
      updateRadiusCopy();
      renderAreas();
    });
    radius.append(element("span", "", "Profile travel radius"), radiusOutput, radiusInput);
    card.append(title, select, copy, radius);
    return card;
  }));
  empty.hidden = areas.length > 0;
  updateRadiusCopy();
  renderMap();
}

function profileUpdate(currentProfile) {
  return {
    biography: currentProfile.biography || "",
    hourlyRatePence: currentProfile.hourlyRatePence,
    fixedPriceOptions: currentProfile.fixedPriceOptions || [],
    travelRadiusKm: Number((travelRadiusMiles / milesPerKilometre).toFixed(2)),
    yearsExperience: currentProfile.yearsExperience,
    languages: currentProfile.languages || [],
    equipmentSupplied: currentProfile.equipmentSupplied || [],
    productsSupplied: currentProfile.productsSupplied || [],
    residentialPreference: currentProfile.residentialPreference === true,
    commercialPreference: currentProfile.commercialPreference === true,
    services: currentProfile.services || [],
    serviceAreas: areas.map(({ outwardPostcode, latitude, longitude }) => ({ outwardPostcode, latitude, longitude })),
    isPublic: currentProfile.isPublic === true
  };
}

export async function setupWorkAreas({ account, showFeedback, requestJson }) {
  document.title = "Work areas | Homle";
  const overview = document.querySelector("[data-registration-overview]");
  const layout = document.querySelector("[data-personal-details]");
  const cards = [
    document.querySelector("[data-personal-card]"),
    document.querySelector("[data-business-details]"),
    document.querySelector("[data-identity-verification]"),
    document.querySelector("[data-background-checks]")
  ];
  const workCard = document.querySelector("[data-work-areas]");
  const topbars = [
    document.querySelector("[data-business-topbar]"),
    document.querySelector("[data-identity-topbar]"),
    document.querySelector("[data-background-topbar]")
  ];
  const workTopbar = document.querySelector("[data-work-topbar]");
  const form = document.querySelector("[data-work-form]");
  if (overview) overview.hidden = true;
  if (layout) layout.hidden = false;
  for (const card of cards) if (card) card.hidden = true;
  if (workCard) workCard.hidden = false;
  for (const topbar of topbars) if (topbar) topbar.hidden = true;
  if (workTopbar) workTopbar.hidden = false;
  if (!(form instanceof HTMLFormElement)) return;

  const [profileResult, availabilityResult, payoutResult] = await Promise.allSettled([
    requestJson("/api/marketplace/cleaner/profile"),
    requestJson("/api/marketplace/cleaner/availability"),
    requestJson("/api/marketplace/cleaner/payout-account")
  ]);
  profile = profileResult.status === "fulfilled" ? profileResult.value.profile : null;
  const availabilityCount = availabilityResult.status === "fulfilled" && Array.isArray(availabilityResult.value.availability)
    ? availabilityResult.value.availability.length
    : 0;
  const payoutState = payoutResult.status === "fulfilled" && payoutResult.value.payoutAccount?.payoutsEnabled ? "ready" : "unavailable";
  renderRail(onboardingProgress({ account, profile, payoutState, availabilityCount }));
  if (!profile) {
    showFeedback("Work areas could not be loaded. Nothing was changed.", "error");
    return;
  }

  areas = Array.isArray(profile.serviceAreas)
    ? profile.serviceAreas.map((area) => ({ outwardPostcode: area.outwardPostcode, latitude: area.latitude, longitude: area.longitude, role: "primary" }))
    : [];
  travelRadiusMiles = Number.isFinite(profile.travelRadiusKm) ? Math.max(1, Math.min(50, Math.round(profile.travelRadiusKm * milesPerKilometre))) : 15;
  const radius = document.querySelector("[data-work-radius]");
  if (radius instanceof HTMLInputElement) {
    radius.value = String(travelRadiusMiles);
    radius.addEventListener("input", () => {
      travelRadiusMiles = Number(radius.value);
      renderAreas();
    });
  }
  renderAreas();

  const search = document.querySelector("[data-work-search]");
  const add = document.querySelector("[data-work-add]");
  const addArea = () => {
    if (!(search instanceof HTMLInputElement)) return;
    const outwardPostcode = normalizedOutwardPostcode(search.value);
    if (!outwardPostcodePattern.test(outwardPostcode)) {
      showFeedback("Enter a valid UK outward postcode such as LS1 or SW1A.", "error");
      return;
    }
    if (areas.some((area) => area.outwardPostcode === outwardPostcode)) {
      showFeedback("That outward postcode is already in your service-area list.", "error");
      return;
    }
    const role = new FormData(form).get("workAreaRole")?.toString() || "primary";
    areas.push({ outwardPostcode, latitude: null, longitude: null, role });
    search.value = "";
    renderAreas();
    showFeedback(role === "primary"
      ? `${outwardPostcode} added to the preview. Save to use it for matching.`
      : `${outwardPostcode} added as a preview-only ${role} area.`);
  };
  add?.addEventListener("click", addArea);
  search?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addArea();
    }
  });
  document.querySelector("[data-work-zoom-in]")?.addEventListener("click", () => {
    mapZoom = Math.min(1.8, mapZoom + 0.2);
    renderMap();
  });
  document.querySelector("[data-work-zoom-out]")?.addEventListener("click", () => {
    mapZoom = Math.max(0.8, mapZoom - 0.2);
    renderMap();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (areas.some((area) => area.role !== "primary")) {
      showFeedback("Change every area to Primary or remove it before saving. Secondary and excluded matching rules are not connected yet.", "error");
      return;
    }
    if (areas.length === 0) {
      showFeedback("Add at least one Primary outward postcode before saving.", "error");
      return;
    }
    const csrf = storedCsrf();
    if (!csrf) {
      showFeedback("Your secure editing token is missing. Sign in again before saving.", "error");
      return;
    }
    const submit = form.querySelector('button[type="submit"]');
    if (submit instanceof HTMLButtonElement) submit.disabled = true;
    try {
      const result = await requestJson("/api/marketplace/cleaner/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(profileUpdate(profile))
      });
      profile = result.profile;
      areas = profile.serviceAreas.map((area) => ({ ...area, role: "primary" }));
      renderAreas();
      showFeedback("Work areas saved. Homle can now use these outward postcodes for matching.", "success");
      location.assign("/cleaner/registration");
    } catch (error) {
      showFeedback(error.message || "Work areas could not be saved.", "error");
    } finally {
      if (submit instanceof HTMLButtonElement) submit.disabled = false;
    }
  });
}

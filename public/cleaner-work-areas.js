import { onboardingProgress } from "./cleaner-onboarding-steps.js?v=20260729-6";
import { storedCsrf } from "./session-csrf.js";
import { normalizedWorkZones } from "./cleaner-work-zones.js?v=20260805-1";
import { postcodeZoneCentres } from "./postcode-zone-centres.js?v=20260805-1";
import {
  clampedMapZoom,
  coordinateFromWorldPixel,
  openStreetMapTileUrl,
  outwardPostcode,
  postcodeDetailsFromReverseResponse,
  postcodeMapTileSize,
  worldPixelFromCoordinate
} from "./postcode-map-core.js?v=20260805-1";

const outwardPostcodePattern = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;
const milesPerKilometre = 0.621371;
const metresPerMile = 1609.344;
const earthCircumferenceMetres = 40075016.686;
let areas = [];
let profile = null;
let travelRadiusMiles = 15;
let savedWorkZones = [];
let postcodeMap = null;

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

function normalizedOutwardPostcode(value) {
  return outwardPostcode(value);
}

function updateRadiusCopy() {
  const output = document.querySelector("[data-work-radius-output]");
  if (output) output.textContent = `${travelRadiusMiles} miles`;
}

function mapSize(host) {
  const bounds = host.getBoundingClientRect();
  return { width: Math.max(320, bounds.width || 480), height: Math.max(420, bounds.height || 510), bounds };
}

function createPostcodeMap({ onAdd, showFeedback }) {
  const host = document.querySelector("[data-postcode-map]");
  const tileLayer = document.querySelector("[data-postcode-map-tiles]");
  const zoneLayer = document.querySelector("[data-postcode-map-zones]");
  const markerLayer = document.querySelector("[data-postcode-map-markers]");
  const status = document.querySelector("[data-postcode-map-status]");
  const detail = document.querySelector("[data-postcode-map-detail]");
  const detailPostcode = document.querySelector("[data-postcode-map-postcode]");
  const detailOutcode = document.querySelector("[data-postcode-map-outcode]");
  const detailPlace = document.querySelector("[data-postcode-map-place]");
  const detailDistance = document.querySelector("[data-postcode-map-distance]");
  const detailAdd = document.querySelector("[data-postcode-map-add]");
  const zoomOutput = document.querySelector("[data-postcode-map-zoom-level]");
  if (!(host instanceof HTMLElement) || !(tileLayer instanceof HTMLElement) || !(zoneLayer instanceof HTMLElement) || !(markerLayer instanceof HTMLElement)) return null;

  const state = { latitude: 54.55, longitude: -3.25, zoom: 5 };
  let selectedPostcode = null;
  let pointer = null;
  let panFrame = 0;
  let pendingPan = null;
  let requestNumber = 0;
  let wheelDelta = 0;
  let wheelFrame = 0;
  let wheelTimer = 0;
  let wheelClientX = null;
  let wheelClientY = null;
  let zoomFrame = 0;
  let queuedZoom = null;

  function setStatus(copy) {
    if (status) status.textContent = copy;
  }

  function markerPosition(latitude, longitude) {
    const { width, height } = mapSize(host);
    const centre = worldPixelFromCoordinate(state.latitude, state.longitude, state.zoom);
    const point = worldPixelFromCoordinate(latitude, longitude, state.zoom);
    let deltaX = point.x - centre.x;
    const worldSize = postcodeMapTileSize * 2 ** state.zoom;
    if (deltaX > worldSize / 2) deltaX -= worldSize;
    if (deltaX < -worldSize / 2) deltaX += worldSize;
    return { x: width / 2 + deltaX, y: height / 2 + point.y - centre.y };
  }

  function renderMarkers() {
    const nodes = [];
    const { width, height } = mapSize(host);
    for (const area of areas.filter((candidate) => Number.isFinite(candidate.latitude) && Number.isFinite(candidate.longitude))) {
      const point = markerPosition(area.latitude, area.longitude);
      if (point.x < -200 || point.x > width + 200 || point.y < -200 || point.y > height + 200) continue;
      if (area.role === "primary") {
        const metresPerPixel = Math.cos(area.latitude * Math.PI / 180) * earthCircumferenceMetres / (postcodeMapTileSize * 2 ** state.zoom);
        const radiusPixels = Math.max(12, Math.min(220, travelRadiusMiles * metresPerMile / Math.max(1, metresPerPixel)));
        const radius = element("span", "hc-postcode-map-radius");
        radius.style.width = `${Math.round(radiusPixels * 2)}px`;
        radius.style.height = `${Math.round(radiusPixels * 2)}px`;
        radius.style.transform = `translate(${Math.round(point.x - radiusPixels)}px, ${Math.round(point.y - radiusPixels)}px)`;
        nodes.push(radius);
      }
      const marker = element("button", "hc-postcode-map-marker", area.outwardPostcode);
      marker.type = "button";
      marker.setAttribute("aria-label", `Centre map on ${area.outwardPostcode}`);
      marker.style.transform = `translate(${Math.round(point.x)}px, ${Math.round(point.y)}px)`;
      marker.addEventListener("click", () => {
        const { width, height } = mapSize(host);
        animateView({
          latitude: area.latitude,
          longitude: area.longitude,
          zoom: Math.max(11, state.zoom),
          originX: Math.max(0, Math.min(100, point.x / width * 100)),
          originY: Math.max(0, Math.min(100, point.y / height * 100)),
          translateX: width / 2 - point.x,
          translateY: height / 2 - point.y
        }, `${area.outwardPostcode} centred on the map.`);
      });
      nodes.push(marker);
    }
    if (selectedPostcode) {
      const point = markerPosition(selectedPostcode.latitude, selectedPostcode.longitude);
      const pin = element("span", "hc-postcode-map-picked", selectedPostcode.outwardPostcode);
      pin.style.transform = `translate(${Math.round(point.x)}px, ${Math.round(point.y)}px)`;
      nodes.push(pin);
    }
    markerLayer.replaceChildren(...nodes);
  }

  function renderPostcodeZones() {
    const { width, height } = mapSize(host);
    const spacing = state.zoom <= 5 ? 46 : state.zoom <= 7 ? 38 : 30;
    const candidates = postcodeZoneCentres
      .map((zone) => ({ ...zone, ...markerPosition(zone.latitude, zone.longitude) }))
      .filter((zone) => zone.x >= 18 && zone.x <= width - 18 && zone.y >= 22 && zone.y <= height - 22)
      .sort((first, second) => {
        const firstDistance = Math.hypot(first.x - width / 2, first.y - height / 2);
        const secondDistance = Math.hypot(second.x - width / 2, second.y - height / 2);
        return firstDistance - secondDistance || first.code.localeCompare(second.code);
      });
    const placed = [];
    const labels = [];
    for (const zone of candidates) {
      if (placed.some((point) => Math.hypot(zone.x - point.x, zone.y - point.y) < spacing)) continue;
      placed.push(zone);
      const label = element("button", "hc-postcode-zone-label", zone.code);
      label.type = "button";
      label.title = `${zone.code} postcode area`;
      label.setAttribute("aria-label", `Zoom to ${zone.code} postcode area`);
      label.style.transform = `translate(${Math.round(zone.x)}px, ${Math.round(zone.y)}px)`;
      label.addEventListener("click", () => {
        const nextZoom = Math.max(8, Math.min(12, state.zoom + 2));
        animateView({
          latitude: zone.latitude,
          longitude: zone.longitude,
          zoom: nextZoom,
          originX: Math.max(0, Math.min(100, zone.x / width * 100)),
          originY: Math.max(0, Math.min(100, zone.y / height * 100)),
          translateX: width / 2 - zone.x,
          translateY: height / 2 - zone.y
        }, `${zone.code} postcode area centred. Click a town or street to find the exact outward postcode.`);
      });
      labels.push(label);
    }
    zoneLayer.replaceChildren(...labels);
  }

  function renderTiles() {
    const { width, height } = mapSize(host);
    const centre = worldPixelFromCoordinate(state.latitude, state.longitude, state.zoom);
    const firstX = Math.floor((centre.x - width / 2) / postcodeMapTileSize);
    const lastX = Math.floor((centre.x + width / 2) / postcodeMapTileSize);
    const firstY = Math.floor((centre.y - height / 2) / postcodeMapTileSize);
    const lastY = Math.floor((centre.y + height / 2) / postcodeMapTileSize);
    const tileCount = 2 ** state.zoom;
    const tiles = [];
    for (let y = firstY; y <= lastY; y += 1) {
      if (y < 0 || y >= tileCount) continue;
      for (let x = firstX; x <= lastX; x += 1) {
        const tile = element("img", "hc-postcode-map-tile");
        tile.alt = "";
        tile.decoding = "async";
        tile.draggable = false;
        tile.src = openStreetMapTileUrl(state.zoom, x, y);
        tile.style.transform = `translate(${Math.round(x * postcodeMapTileSize - centre.x + width / 2)}px, ${Math.round(y * postcodeMapTileSize - centre.y + height / 2)}px)`;
        tiles.push(tile);
      }
    }
    tileLayer.replaceChildren(...tiles);
    if (zoomOutput) zoomOutput.textContent = `Zoom ${state.zoom}`;
    renderPostcodeZones();
    renderMarkers();
  }

  function showPostcodeDetails(details) {
    selectedPostcode = details;
    if (detailPostcode) detailPostcode.textContent = details.postcode;
    if (detailOutcode) detailOutcode.textContent = `${details.outwardPostcode} outward postcode`;
    if (detailPlace) detailPlace.textContent = [details.ward, details.district, details.region, details.country].filter(Boolean).join(" · ");
    if (detailDistance) detailDistance.textContent = details.distanceMetres > 0 ? `${details.distanceMetres} metres from your click` : "Nearest mapped postcode";
    if (detailAdd instanceof HTMLButtonElement) detailAdd.textContent = `Add ${details.outwardPostcode}`;
    if (detail) detail.hidden = false;
    renderMarkers();
  }

  async function reverseLookup(latitude, longitude) {
    const currentRequest = ++requestNumber;
    setStatus("Finding the nearest UK postcode…");
    try {
      const query = new URLSearchParams({ lat: latitude.toFixed(6), lon: longitude.toFixed(6), limit: "1", radius: "2000" });
      const response = await fetch(`https://api.postcodes.io/postcodes?${query}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Postcode lookup is unavailable.");
      const details = postcodeDetailsFromReverseResponse(await response.json());
      if (currentRequest !== requestNumber) return;
      if (!details) throw new Error("No UK postcode was found at that point. Try a nearby street or town.");
      state.latitude = details.latitude;
      state.longitude = details.longitude;
      state.zoom = Math.max(11, state.zoom);
      showPostcodeDetails(details);
      renderTiles();
      setStatus(`${details.postcode} selected. Review the area details, then add ${details.outwardPostcode}.`);
    } catch (error) {
      if (currentRequest !== requestNumber) return;
      setStatus(error.message || "The postcode lookup could not be completed. Enter the outward postcode manually instead.");
      showFeedback(error.message || "Postcode lookup could not be completed.", "error");
    }
  }

  function coordinateAt(clientX, clientY) {
    const { width, height, bounds } = mapSize(host);
    const centre = worldPixelFromCoordinate(state.latitude, state.longitude, state.zoom);
    return coordinateFromWorldPixel(
      centre.x + clientX - bounds.left - width / 2,
      centre.y + clientY - bounds.top - height / 2,
      state.zoom
    );
  }

  function zoomTarget(change, clientX = null, clientY = null) {
    const next = clampedMapZoom(state.zoom + change);
    if (next === state.zoom) return null;
    const { width, height, bounds } = mapSize(host);
    const offsetX = Number.isFinite(clientX) ? clientX - bounds.left - width / 2 : 0;
    const offsetY = Number.isFinite(clientY) ? clientY - bounds.top - height / 2 : 0;
    const currentCentre = worldPixelFromCoordinate(state.latitude, state.longitude, state.zoom);
    const anchor = coordinateFromWorldPixel(currentCentre.x + offsetX, currentCentre.y + offsetY, state.zoom);
    const nextAnchor = worldPixelFromCoordinate(anchor.latitude, anchor.longitude, next);
    const nextCentre = coordinateFromWorldPixel(nextAnchor.x - offsetX, nextAnchor.y - offsetY, next);
    return {
      latitude: nextCentre.latitude,
      longitude: nextCentre.longitude,
      zoom: next,
      originX: Math.max(0, Math.min(100, (offsetX + width / 2) / width * 100)),
      originY: Math.max(0, Math.min(100, (offsetY + height / 2) / height * 100)),
      translateX: 0,
      translateY: 0
    };
  }

  function animateView(target, completionCopy = "") {
    if (!target) return;
    if (zoomFrame) {
      return;
    }
    const zoomDifference = target.zoom - state.zoom;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    const duration = reducedMotion ? 0 : Math.min(520, 300 + Math.abs(zoomDifference) * 70);
    host.style.setProperty("--hc-map-zoom-x", `${target.originX}%`);
    host.style.setProperty("--hc-map-zoom-y", `${target.originY}%`);
    host.style.setProperty("--hc-map-zoom-scale", "1");
    host.style.setProperty("--hc-map-pan-x", "0px");
    host.style.setProperty("--hc-map-pan-y", "0px");
    host.classList.add("is-zooming");

    const finish = () => {
      Object.assign(state, { latitude: target.latitude, longitude: target.longitude, zoom: target.zoom });
      renderTiles();
      host.style.setProperty("--hc-map-zoom-scale", "1");
      host.style.setProperty("--hc-map-pan-x", "0px");
      host.style.setProperty("--hc-map-pan-y", "0px");
      host.classList.remove("is-zooming");
      setStatus(completionCopy || `Map zoomed to level ${state.zoom}. Click a location to see its nearest postcode.`);
      zoomFrame = 0;
      const queued = queuedZoom;
      queuedZoom = null;
      if (queued) changeZoom(queued.change, queued.clientX, queued.clientY);
    };

    if (!duration) {
      finish();
      return;
    }

    let startedAt = null;
    const step = (timestamp) => {
      if (startedAt === null) startedAt = timestamp;
      const progress = Math.min(1, (timestamp - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      host.style.setProperty("--hc-map-zoom-scale", String(2 ** (zoomDifference * eased)));
      host.style.setProperty("--hc-map-pan-x", `${(target.translateX || 0) * eased}px`);
      host.style.setProperty("--hc-map-pan-y", `${(target.translateY || 0) * eased}px`);
      if (progress < 1) zoomFrame = requestAnimationFrame(step);
      else finish();
    };
    zoomFrame = requestAnimationFrame(step);
  }

  function changeZoom(change, clientX = null, clientY = null) {
    if (zoomFrame) {
      queuedZoom = {
        change: (queuedZoom?.change || 0) + change,
        clientX: Number.isFinite(clientX) ? clientX : queuedZoom?.clientX,
        clientY: Number.isFinite(clientY) ? clientY : queuedZoom?.clientY
      };
      return;
    }
    animateView(zoomTarget(change, clientX, clientY));
  }

  host.addEventListener("pointerdown", (event) => {
    if (zoomFrame || event.target.closest("button, a, article")) return;
    const centre = worldPixelFromCoordinate(state.latitude, state.longitude, state.zoom);
    pointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY, centreX: centre.x, centreY: centre.y, moved: false };
    host.setPointerCapture?.(event.pointerId);
    host.classList.add("is-dragging");
  });
  host.addEventListener("pointermove", (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const deltaX = event.clientX - pointer.startX;
    const deltaY = event.clientY - pointer.startY;
    pointer.moved ||= Math.hypot(deltaX, deltaY) > 5;
    pendingPan = coordinateFromWorldPixel(pointer.centreX - deltaX, pointer.centreY - deltaY, state.zoom);
    if (!panFrame) {
      panFrame = requestAnimationFrame(() => {
        if (pendingPan) Object.assign(state, pendingPan);
        pendingPan = null;
        panFrame = 0;
        renderTiles();
      });
    }
  });
  host.addEventListener("pointerup", (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const moved = pointer.moved;
    pointer = null;
    host.classList.remove("is-dragging");
    if (!moved) {
      const coordinate = coordinateAt(event.clientX, event.clientY);
      reverseLookup(coordinate.latitude, coordinate.longitude);
    }
  });
  host.addEventListener("pointercancel", () => {
    pointer = null;
    pendingPan = null;
    host.classList.remove("is-dragging");
  });
  host.addEventListener("wheel", (event) => {
    event.preventDefault();
    const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1;
    wheelDelta += event.deltaY * multiplier;
    wheelClientX = event.clientX;
    wheelClientY = event.clientY;
    window.clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(() => {
      wheelDelta = 0;
    }, 160);
    if (wheelFrame) return;
    wheelFrame = requestAnimationFrame(() => {
      wheelFrame = 0;
      const threshold = 54;
      if (Math.abs(wheelDelta) < threshold) return;
      const steps = Math.min(3, Math.max(1, Math.floor(Math.abs(wheelDelta) / threshold)));
      const direction = wheelDelta < 0 ? 1 : -1;
      wheelDelta += direction * threshold * steps;
      changeZoom(direction * steps, wheelClientX, wheelClientY);
    });
  }, { passive: false });
  host.addEventListener("keydown", (event) => {
    const pan = Math.max(24, 180 / 2 ** Math.max(0, state.zoom - 5));
    if (event.key === "+" || event.key === "=") changeZoom(1);
    else if (event.key === "-") changeZoom(-1);
    else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const centre = worldPixelFromCoordinate(state.latitude, state.longitude, state.zoom);
      if (event.key === "ArrowLeft") centre.x -= pan;
      if (event.key === "ArrowRight") centre.x += pan;
      if (event.key === "ArrowUp") centre.y -= pan;
      if (event.key === "ArrowDown") centre.y += pan;
      Object.assign(state, coordinateFromWorldPixel(centre.x, centre.y, state.zoom));
      renderTiles();
    }
  });
  document.querySelector("[data-postcode-map-zoom-in]")?.addEventListener("click", () => changeZoom(1));
  document.querySelector("[data-postcode-map-zoom-out]")?.addEventListener("click", () => changeZoom(-1));
  document.querySelector("[data-postcode-map-reset]")?.addEventListener("click", () => {
    selectedPostcode = null;
    if (detail) detail.hidden = true;
    animateView({ latitude: 54.55, longitude: -3.25, zoom: 5, originX: 50, originY: 50, translateX: 0, translateY: 0 }, "UK view restored. Click any town, street or area to find its nearest postcode.");
  });
  detailAdd?.addEventListener("click", () => {
    if (selectedPostcode) onAdd(selectedPostcode);
  });
  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(renderTiles) : null;
  resizeObserver?.observe(host);
  renderTiles();

  return {
    render: renderMarkers,
    centreOn(latitude, longitude, zoom = 11) {
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      Object.assign(state, { latitude, longitude, zoom: clampedMapZoom(zoom) });
      renderTiles();
    },
    async locateOutcode(code) {
      const response = await fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(code)}`, { headers: { Accept: "application/json" } });
      if (!response.ok) return null;
      const record = (await response.json())?.result;
      const latitude = Number(record?.latitude);
      const longitude = Number(record?.longitude);
      return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
    }
  };
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
      element("span", "", area.latitude == null ? "Coordinates resolve securely when saved" : "Postcode coordinates ready"),
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
  postcodeMap?.render();
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
    serviceAreas: areas.map(({ outwardPostcode: code, latitude, longitude }) => ({ outwardPostcode: code, latitude, longitude })),
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

  const [profileResult, availabilityResult, payoutResult, workZoneResult] = await Promise.allSettled([
    requestJson("/api/marketplace/cleaner/profile"),
    requestJson("/api/marketplace/cleaner/availability"),
    requestJson("/api/marketplace/cleaner/payout-account"),
    requestJson("/api/marketplace/cleaner/onboarding/areas")
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
  savedWorkZones = normalizedWorkZones(workZoneResult.status === "fulfilled" ? workZoneResult.value.section?.data?.workZones : []);
  travelRadiusMiles = Number.isFinite(profile.travelRadiusKm) ? Math.max(1, Math.min(50, Math.round(profile.travelRadiusKm * milesPerKilometre))) : 15;

  function selectedRole() {
    return new FormData(form).get("workAreaRole")?.toString() || "primary";
  }

  function addArea(code, coordinates = null) {
    const normalized = normalizedOutwardPostcode(code);
    if (!outwardPostcodePattern.test(normalized)) {
      showFeedback("Enter a valid UK postcode such as LS1 or SW1A 1AA.", "error");
      return null;
    }
    if (areas.some((area) => area.outwardPostcode === normalized)) {
      showFeedback("That outward postcode is already in your service-area list.", "error");
      return null;
    }
    const role = selectedRole();
    const area = {
      outwardPostcode: normalized,
      latitude: Number.isFinite(coordinates?.latitude) ? coordinates.latitude : null,
      longitude: Number.isFinite(coordinates?.longitude) ? coordinates.longitude : null,
      role
    };
    areas.push(area);
    renderAreas();
    showFeedback(role === "primary"
      ? `${normalized} added. Save to use it for postcode matching.`
      : `${normalized} added as a preview-only ${role} area.`, "success");
    return area;
  }

  postcodeMap = createPostcodeMap({
    showFeedback,
    onAdd(details) {
      const added = addArea(details.outwardPostcode, details);
      if (added) postcodeMap?.centreOn(details.latitude, details.longitude, 12);
    }
  });

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
  const addTypedArea = async () => {
    if (!(search instanceof HTMLInputElement)) return;
    const code = normalizedOutwardPostcode(search.value);
    const added = addArea(code);
    if (!added) return;
    search.value = "";
    try {
      const coordinates = await postcodeMap?.locateOutcode(code);
      if (coordinates) {
        Object.assign(added, coordinates);
        postcodeMap?.centreOn(coordinates.latitude, coordinates.longitude, 11);
        renderAreas();
      }
    } catch {
      // The server resolves valid outward-postcode coordinates again when saved.
    }
  };
  add?.addEventListener("click", addTypedArea);
  search?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addTypedArea();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (areas.some((area) => area.role !== "primary")) {
      showFeedback("Change every area to Primary or remove it before saving. Secondary and excluded matching rules are not connected yet.", "error");
      return;
    }
    if (areas.length === 0 && savedWorkZones.length === 0) {
      showFeedback("Click the UK map or enter at least one outward postcode before saving.", "error");
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
      await requestJson("/api/marketplace/cleaner/onboarding/areas", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({
          status: "submitted",
          data: {
            workZones: savedWorkZones,
            outwardPostcodes: areas.map((area) => area.outwardPostcode),
            travelRadiusMiles
          }
        })
      });
      if (areas.length > 0) {
        const result = await requestJson("/api/marketplace/cleaner/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify(profileUpdate(profile))
        });
        profile = result.profile;
        areas = profile.serviceAreas.map((area) => ({ ...area, role: "primary" }));
      }
      renderAreas();
      showFeedback("Your outward postcodes and travel radius were saved for precise matching.", "success");
      location.assign("/cleaner/onboarding");
    } catch (error) {
      showFeedback(error.message || "Work areas could not be saved.", "error");
    } finally {
      if (submit instanceof HTMLButtonElement) submit.disabled = false;
    }
  });
}

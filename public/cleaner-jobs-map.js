import {
  bookingSummaryBuckets,
  bookingSummaryStatusLabels,
  formatBookingMoney,
  formatBookingWindow
} from "./booking-summary-model.js?v=20260723-3";
import { createCleanerPage, element, requestJson } from "./cleaner-page.js?v=20260729-6";
import {
  clampedMapZoom,
  coordinateFromWorldPixel,
  openStreetMapTileUrl,
  postcodeMapTileSize,
  worldPixelFromCoordinate
} from "./postcode-map-core.js?v=20260805-1";

const localPreview = ["127.0.0.1", "localhost"].includes(location.hostname);
const mapHost = document.querySelector("[data-area-map]");
const tileHost = document.querySelector("[data-map-tiles]");
const pinHost = document.querySelector("[data-map-pins]");
const listHost = document.querySelector("[data-map-list]");
const mapState = { latitude: 51.372, longitude: -0.102, zoom: 12 };
let mappedJobs = [];
let pointer = null;

function previewDate(daysAhead, hour, durationHours) {
  const start = new Date();
  start.setDate(start.getDate() + daysAhead);
  start.setHours(hour, 0, 0, 0);
  const end = new Date(start.getTime() + durationHours * 60 * 60_000);
  return { scheduledStartAt: start.toISOString(), scheduledEndAt: end.toISOString() };
}

function previewJobs() {
  return [
    {
      bookingId: "preview-cr0-deep-clean",
      preview: true,
      participantRole: "cleaner",
      status: "pending-cleaner-acceptance",
      cleaningType: "Deep clean",
      locationLabel: "Central Croydon, CR0",
      propertyArea: "CR0",
      mapDistrict: "Croydon",
      latitude: 51.372,
      longitude: -0.101,
      propertyType: "2-bedroom flat",
      pricePence: 6800,
      distanceMiles: 2.4,
      taskCount: 8,
      imageLabels: ["Kitchen", "Living room", "Bathroom"],
      ...previewDate(2, 9, 4)
    },
    {
      bookingId: "preview-cr2-regular-clean",
      preview: true,
      participantRole: "cleaner",
      status: "pending-cleaner-acceptance",
      cleaningType: "Regular home clean",
      locationLabel: "South Croydon, CR2",
      propertyArea: "CR2",
      mapDistrict: "Croydon",
      latitude: 51.349,
      longitude: -0.091,
      propertyType: "3-bedroom house",
      pricePence: 4800,
      distanceMiles: 3.8,
      taskCount: 6,
      imageLabels: ["Kitchen", "Bedroom", "Hallway"],
      ...previewDate(4, 12, 3)
    },
    {
      bookingId: "preview-cr7-end-tenancy",
      preview: true,
      participantRole: "cleaner",
      status: "pending-cleaner-acceptance",
      cleaningType: "End of tenancy",
      locationLabel: "Thornton Heath, CR7",
      propertyArea: "CR7",
      mapDistrict: "Croydon",
      latitude: 51.398,
      longitude: -0.101,
      propertyType: "1-bedroom flat",
      pricePence: 9200,
      distanceMiles: 5.1,
      taskCount: 11,
      imageLabels: ["Kitchen", "Bedroom", "Bathroom"],
      ...previewDate(6, 10, 5)
    }
  ];
}

function bookingPhotoUrls(booking) {
  return [booking.images, booking.photos, booking.propertyPhotos]
    .flatMap((value) => Array.isArray(value) ? value : [])
    .map((value) => typeof value === "string" ? value : value?.url)
    .filter((value) => typeof value === "string" && value.startsWith("/"))
    .slice(0, 3);
}

function svgNode(name, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function roomPreview(label, index) {
  const palettes = [
    ["#f7dcd0", "#dd4a36", "#8e3f34"],
    ["#dcebe5", "#4e907e", "#315f56"],
    ["#eee2cc", "#d5a64f", "#806333"]
  ];
  const [background, accent, ink] = palettes[index % palettes.length];
  const svg = svgNode("svg", { viewBox: "0 0 180 112", role: "img", "aria-label": `${label} example image` });
  const title = svgNode("title");
  title.textContent = `${label} example image`;
  svg.append(
    title,
    svgNode("rect", { width: 180, height: 112, rx: 12, fill: background }),
    svgNode("path", { d: "M0 82 L180 70 L180 112 L0 112 Z", fill: "#fffaf2" }),
    svgNode("rect", { x: 112, y: 17, width: 45, height: 38, rx: 4, fill: "#fffdf8", stroke: ink, "stroke-width": 2 }),
    svgNode("path", { d: "M134.5 18 V54 M113 36 H156", fill: "none", stroke: ink, "stroke-width": 1.4, opacity: ".55" }),
    svgNode("path", { d: "M24 73 Q24 60 38 60 H84 Q97 60 97 73 V88 H24 Z", fill: accent }),
    svgNode("path", { d: "M31 87 V96 M90 87 V96", fill: "none", stroke: ink, "stroke-width": 4, "stroke-linecap": "round" })
  );
  return svg;
}

function renderImages(booking) {
  const gallery = element("div", "hc-jobs-map-gallery");
  const urls = bookingPhotoUrls(booking);
  const labels = Array.isArray(booking.imageLabels) && booking.imageLabels.length ? booking.imageLabels : ["Property", "Room", "Clean details"];
  if (!urls.length && !booking.preview) {
    gallery.append(element("p", "hc-jobs-map-no-images", "No property images were supplied with this offer."));
    return gallery;
  }
  for (let index = 0; index < 3; index += 1) {
    const frame = element("figure", "hc-jobs-map-image");
    if (urls[index]) {
      const image = document.createElement("img");
      image.src = urls[index];
      image.alt = `${labels[index] || "Property"} for this clean`;
      image.loading = "lazy";
      frame.append(image);
    } else {
      frame.append(roomPreview(labels[index] || "Property", index));
    }
    frame.append(element("figcaption", "", labels[index] || "Property"));
    gallery.append(frame);
  }
  return gallery;
}

function durationLabel(booking) {
  const start = new Date(booking.scheduledStartAt || "");
  const end = new Date(booking.scheduledEndAt || "");
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return "Duration TBC";
  const hours = (end - start) / 3_600_000;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} ${hours === 1 ? "hour" : "hours"}`;
}

function mapSize() {
  const bounds = mapHost.getBoundingClientRect();
  return { width: Math.max(320, bounds.width || 480), height: Math.max(360, bounds.height || 500) };
}

function mapPosition(latitude, longitude) {
  const { width, height } = mapSize();
  const centre = worldPixelFromCoordinate(mapState.latitude, mapState.longitude, mapState.zoom);
  const point = worldPixelFromCoordinate(latitude, longitude, mapState.zoom);
  return { x: width / 2 + point.x - centre.x, y: height / 2 + point.y - centre.y };
}

function renderTiles() {
  const { width, height } = mapSize();
  const centre = worldPixelFromCoordinate(mapState.latitude, mapState.longitude, mapState.zoom);
  const firstX = Math.floor((centre.x - width / 2) / postcodeMapTileSize);
  const lastX = Math.floor((centre.x + width / 2) / postcodeMapTileSize);
  const firstY = Math.floor((centre.y - height / 2) / postcodeMapTileSize);
  const lastY = Math.floor((centre.y + height / 2) / postcodeMapTileSize);
  const count = 2 ** mapState.zoom;
  const tiles = [];
  for (let y = firstY; y <= lastY; y += 1) {
    if (y < 0 || y >= count) continue;
    for (let x = firstX; x <= lastX; x += 1) {
      const tile = document.createElement("img");
      tile.className = "hc-jobs-map-tile";
      tile.alt = "";
      tile.decoding = "async";
      tile.draggable = false;
      tile.src = openStreetMapTileUrl(mapState.zoom, x, y);
      tile.style.transform = `translate(${Math.round(x * postcodeMapTileSize - centre.x + width / 2)}px, ${Math.round(y * postcodeMapTileSize - centre.y + height / 2)}px)`;
      tiles.push(tile);
    }
  }
  tileHost.replaceChildren(...tiles);
  renderMapPins();
  document.querySelector("[data-map-zoom-level]").textContent = `Zoom ${mapState.zoom}`;
  document.querySelector("[data-map-zoom-out]").disabled = mapState.zoom <= 8;
  document.querySelector("[data-map-zoom-in]").disabled = mapState.zoom >= 16;
}

function fitMatchedJobs() {
  if (!mappedJobs.length) return;
  mapState.latitude = mappedJobs.reduce((total, job) => total + job.latitude, 0) / mappedJobs.length;
  mapState.longitude = mappedJobs.reduce((total, job) => total + job.longitude, 0) / mappedJobs.length;
  const { width, height } = mapSize();
  let fittedZoom = 15;
  for (; fittedZoom >= 8; fittedZoom -= 1) {
    const centre = worldPixelFromCoordinate(mapState.latitude, mapState.longitude, fittedZoom);
    const fits = mappedJobs.every((job) => {
      const point = worldPixelFromCoordinate(job.latitude, job.longitude, fittedZoom);
      return Math.abs(point.x - centre.x) <= width * .34 && Math.abs(point.y - centre.y) <= height * .34;
    });
    if (fits) break;
  }
  mapState.zoom = clampedMapZoom(fittedZoom, 8, 16);
  renderTiles();
}

async function resolveMatchedJobs(bookings) {
  const cache = new Map();
  const resolved = [];
  for (const booking of bookings) {
    let latitude = Number(booking.latitude);
    let longitude = Number(booking.longitude);
    let district = String(booking.mapDistrict || booking.locationLabel || "").split(",")[0].trim();
    const outcode = String(booking.propertyArea || "").trim().toUpperCase();
    if ((!Number.isFinite(latitude) || !Number.isFinite(longitude)) && outcode) {
      let location = cache.get(outcode);
      if (location === undefined) {
        try {
          const response = await fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(outcode)}`, { headers: { Accept: "application/json" } });
          const record = response.ok ? (await response.json())?.result : null;
          location = Number.isFinite(Number(record?.latitude)) && Number.isFinite(Number(record?.longitude))
            ? { latitude: Number(record.latitude), longitude: Number(record.longitude), district: String(record.admin_district || "").trim() }
            : null;
        } catch { location = null; }
        cache.set(outcode, location);
      }
      if (location) ({ latitude, longitude, district = location.district || district } = location);
    }
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) resolved.push({ booking, latitude, longitude, district, outcode });
  }
  return resolved;
}

async function updateMatchedAreaMap(bookings) {
  mappedJobs = await resolveMatchedJobs(bookings);
  const districts = [...new Set(mappedJobs.map((job) => job.district).filter(Boolean))];
  const outcodes = [...new Set(mappedJobs.map((job) => job.outcode).filter(Boolean))];
  const areaTitle = document.querySelector("[data-map-area-title]");
  const areaCopy = document.querySelector("[data-map-area-copy]");
  if (!mappedJobs.length) {
    areaTitle.textContent = "Matched area map";
    areaCopy.textContent = bookings.length ? "Postcode coordinates are temporarily unavailable" : "Available jobs will be mapped here";
    pinHost.replaceChildren();
    return;
  }
  areaTitle.textContent = districts.length === 1 ? `${districts[0]} jobs` : outcodes.length === 1 ? `${outcodes[0]} jobs` : "Your matched job areas";
  areaCopy.textContent = `${outcodes.join(", ")} · showing ${mappedJobs.length} available ${mappedJobs.length === 1 ? "job" : "jobs"}`;
  fitMatchedJobs();
}

function selectJob(bookingId, { scroll = false } = {}) {
  for (const card of document.querySelectorAll("[data-map-job-id]")) {
    const selected = card.dataset.mapJobId === bookingId;
    card.classList.toggle("is-selected", selected);
    if (selected && scroll) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  for (const pin of document.querySelectorAll("[data-map-pin-id]")) {
    const selected = pin.dataset.mapPinId === bookingId;
    pin.classList.toggle("is-selected", selected);
    pin.setAttribute("aria-pressed", String(selected));
  }
}

function detailItem(label, value) {
  const item = element("div", "hc-jobs-map-detail");
  item.append(element("dt", "", label), element("dd", "", value));
  return item;
}

function renderCard(booking, index) {
  const card = element("article", "hc-jobs-map-card");
  card.dataset.mapJobId = booking.bookingId;
  const marker = element("span", "hc-jobs-map-card-marker", String(index + 1));
  const heading = element("div", "hc-jobs-map-card-heading");
  const copy = element("div", "hc-jobs-map-card-copy");
  copy.append(
    element("span", "hc-jobs-map-card-status", booking.preview ? "Example available job" : bookingSummaryStatusLabels[booking.status] || "Available job"),
    element("h3", "", booking.cleaningType || "Cleaning job"),
    element("p", "", booking.locationLabel || booking.propertyArea || "Approximate area shared with the offer")
  );
  heading.append(marker, copy, element("strong", "hc-jobs-map-card-price", formatBookingMoney(booking.pricePence)));

  const details = element("dl", "hc-jobs-map-details");
  details.append(
    detailItem("Date & time", formatBookingWindow(booking.scheduledStartAt, booking.scheduledEndAt)),
    detailItem("Duration", durationLabel(booking)),
    detailItem("Property", booking.propertyType || "Property details provided in the offer"),
    detailItem("Work", Number(booking.taskCount) > 0 ? `${booking.taskCount} cleaning tasks` : "Task list provided in the offer"),
    detailItem("Distance", Number.isFinite(Number(booking.distanceMiles)) ? `${Number(booking.distanceMiles).toFixed(1)} miles away` : "Distance calculated from your work areas"),
    detailItem("Location", booking.locationLabel || booking.propertyArea || "Approximate area only")
  );

  const footer = element("div", "hc-jobs-map-card-footer");
  const privacy = element("span", "", booking.preview ? "Preview only — no action will be sent" : "The exact address opens only after confirmation");
  if (booking.preview) {
    const button = element("button", "hc-btn", "Preview details");
    button.type = "button";
    button.disabled = true;
    footer.append(privacy, button);
  } else {
    const link = element("a", "hc-btn", "Review job");
    link.href = `/cleaner/jobs/${encodeURIComponent(booking.bookingId)}`;
    footer.append(privacy, link);
  }
  card.append(heading, renderImages(booking), details, footer);
  card.addEventListener("click", () => selectJob(booking.bookingId));
  return card;
}

function renderPin(mappedJob, index) {
  const { booking, latitude, longitude } = mappedJob;
  const position = mapPosition(latitude, longitude);
  const { width, height } = mapSize();
  if (position.x < -40 || position.x > width + 40 || position.y < -40 || position.y > height + 40) return null;
  const pin = element("button", "hc-jobs-map-pin", String(index + 1));
  pin.type = "button";
  pin.style.left = `${Math.round(position.x)}px`;
  pin.style.top = `${Math.round(position.y)}px`;
  pin.dataset.mapPinId = booking.bookingId;
  pin.setAttribute("aria-label", `${booking.cleaningType || "Cleaning job"} in ${booking.propertyArea || "your area"}, ${formatBookingMoney(booking.pricePence)}`);
  pin.setAttribute("aria-pressed", "false");
  pin.addEventListener("click", () => selectJob(booking.bookingId, { scroll: true }));
  return pin;
}

function renderMapPins() {
  pinHost.replaceChildren(...mappedJobs.map(renderPin).filter(Boolean));
  const selected = document.querySelector(".hc-jobs-map-card.is-selected")?.dataset.mapJobId;
  if (selected) selectJob(selected);
}

function renderJobs(bookings, { preview = false } = {}) {
  const jobs = Array.isArray(bookings) ? bookings : [];
  const areas = new Set(jobs.map((booking) => String(booking.propertyArea || "").trim()).filter(Boolean));
  const highest = jobs.reduce((value, booking) => Math.max(value, Number(booking.pricePence) || 0), 0);
  document.querySelector("[data-map-preview]").hidden = !preview;
  document.querySelector("[data-map-empty]").hidden = jobs.length > 0;
  document.querySelector("[data-map-count]").textContent = String(jobs.length);
  document.querySelector("[data-map-area-count]").textContent = String(areas.size);
  document.querySelector("[data-map-highest-pay]").textContent = highest ? formatBookingMoney(highest) : "—";
  listHost.replaceChildren(...jobs.map(renderCard));
  if (jobs[0]) selectJob(jobs[0].bookingId);
  updateMatchedAreaMap(jobs);
}

function updateZoom(change) {
  mapState.zoom = clampedMapZoom(mapState.zoom + change, 8, 16);
  renderTiles();
}

document.querySelector("[data-map-zoom-out]")?.addEventListener("click", () => updateZoom(-1));
document.querySelector("[data-map-zoom-in]")?.addEventListener("click", () => updateZoom(1));
document.querySelector("[data-map-reset]")?.addEventListener("click", fitMatchedJobs);

mapHost?.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button, a")) return;
  const centre = worldPixelFromCoordinate(mapState.latitude, mapState.longitude, mapState.zoom);
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, centre };
  mapHost.setPointerCapture?.(event.pointerId);
  mapHost.classList.add("is-dragging");
});
mapHost?.addEventListener("pointermove", (event) => {
  if (!pointer || pointer.id !== event.pointerId) return;
  const coordinate = coordinateFromWorldPixel(pointer.centre.x - (event.clientX - pointer.x), pointer.centre.y - (event.clientY - pointer.y), mapState.zoom);
  mapState.latitude = coordinate.latitude;
  mapState.longitude = coordinate.longitude;
  renderTiles();
});
function finishPointer(event) {
  if (!pointer || pointer.id !== event.pointerId) return;
  pointer = null;
  mapHost.classList.remove("is-dragging");
}
mapHost?.addEventListener("pointerup", finishPointer);
mapHost?.addEventListener("pointercancel", finishPointer);
mapHost?.addEventListener("wheel", (event) => {
  event.preventDefault();
  updateZoom(event.deltaY < 0 ? 1 : -1);
}, { passive: false });
mapHost?.addEventListener("keydown", (event) => {
  if (event.key === "+" || event.key === "=") updateZoom(1);
  else if (event.key === "-") updateZoom(-1);
  else return;
  event.preventDefault();
});
if (mapHost && typeof ResizeObserver === "function") new ResizeObserver(() => renderTiles()).observe(mapHost);

async function loadRealJobs({ showFeedback }) {
  try {
    const result = await requestJson("/api/marketplace/bookings?limit=50");
    const bookings = Array.isArray(result.bookings) ? result.bookings : [];
    const available = bookingSummaryBuckets(bookings, "cleaner").pending;
    renderJobs(available);
  } catch (error) {
    renderJobs([]);
    showFeedback(error?.message || "Available jobs could not be loaded. Try again shortly.", "error");
  }
}

if (localPreview) {
  const gate = document.querySelector("[data-map-gate]");
  const view = document.querySelector("[data-map]");
  if (gate) gate.hidden = true;
  if (view) view.hidden = false;
  document.querySelector("[data-year]").textContent = String(new Date().getFullYear());
  renderJobs(previewJobs(), { preview: true });
} else {
  createCleanerPage("map", loadRealJobs);
}

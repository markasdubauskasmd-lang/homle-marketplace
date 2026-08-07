import {
  bookingSummaryBuckets,
  bookingSummaryStatusLabels,
  formatBookingMoney,
  formatBookingWindow
} from "./booking-summary-model.js?v=20260723-3";
import { createCleanerPage, element, requestJson } from "./cleaner-page.js?v=20260729-6";

const localPreview = ["127.0.0.1", "localhost"].includes(location.hostname);
const mapWorld = document.querySelector("[data-map-world]");
const pinHost = document.querySelector("[data-map-pins]");
const listHost = document.querySelector("[data-map-list]");
let zoom = 1;

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
      bookingId: "preview-sw11-deep-clean",
      preview: true,
      participantRole: "cleaner",
      status: "pending-cleaner-acceptance",
      cleaningType: "Deep clean",
      locationLabel: "Battersea, SW11",
      propertyArea: "SW11",
      propertyType: "2-bedroom flat",
      pricePence: 6800,
      distanceMiles: 2.4,
      taskCount: 8,
      imageLabels: ["Kitchen", "Living room", "Bathroom"],
      ...previewDate(2, 9, 4)
    },
    {
      bookingId: "preview-sw4-regular-clean",
      preview: true,
      participantRole: "cleaner",
      status: "pending-cleaner-acceptance",
      cleaningType: "Regular home clean",
      locationLabel: "Clapham, SW4",
      propertyArea: "SW4",
      propertyType: "3-bedroom house",
      pricePence: 4800,
      distanceMiles: 3.8,
      taskCount: 6,
      imageLabels: ["Kitchen", "Bedroom", "Hallway"],
      ...previewDate(4, 12, 3)
    },
    {
      bookingId: "preview-se1-end-tenancy",
      preview: true,
      participantRole: "cleaner",
      status: "pending-cleaner-acceptance",
      cleaningType: "End of tenancy",
      locationLabel: "Southwark, SE1",
      propertyArea: "SE1",
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

function jobPosition(booking, index) {
  const source = `${booking.propertyArea || "UK"}-${index}`;
  let hash = 0;
  for (const character of source) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return { left: 18 + hash % 64, top: 18 + Math.floor(hash / 97) % 60 };
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

function renderPin(booking, index) {
  const pin = element("button", "hc-jobs-map-pin", String(index + 1));
  const position = jobPosition(booking, index);
  pin.type = "button";
  pin.style.left = `${position.left}%`;
  pin.style.top = `${position.top}%`;
  pin.dataset.mapPinId = booking.bookingId;
  pin.setAttribute("aria-label", `${booking.cleaningType || "Cleaning job"} in ${booking.propertyArea || "your area"}, ${formatBookingMoney(booking.pricePence)}`);
  pin.setAttribute("aria-pressed", "false");
  pin.addEventListener("click", () => selectJob(booking.bookingId, { scroll: true }));
  return pin;
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
  pinHost.replaceChildren(...jobs.map(renderPin));
  if (jobs[0]) selectJob(jobs[0].bookingId);
}

function updateZoom(nextZoom) {
  zoom = Math.min(1.35, Math.max(.8, nextZoom));
  mapWorld.style.setProperty("--jobs-map-scale", String(zoom));
  document.querySelector("[data-map-zoom-level]").textContent = `${Math.round(zoom * 100)}%`;
  document.querySelector("[data-map-zoom-out]").disabled = zoom <= .8;
  document.querySelector("[data-map-zoom-in]").disabled = zoom >= 1.35;
}

document.querySelector("[data-map-zoom-out]")?.addEventListener("click", () => updateZoom(zoom - .1));
document.querySelector("[data-map-zoom-in]")?.addEventListener("click", () => updateZoom(zoom + .1));
document.querySelector("[data-map-reset]")?.addEventListener("click", () => updateZoom(1));

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

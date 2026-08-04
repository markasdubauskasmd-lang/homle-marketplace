import { bookingSummaryBuckets, bookingSummaryStatusLabels, formatBookingMoney } from "./booking-summary-model.js?v=20260723-3";
import { createCleanerPage, element, requestJson, setText } from "./cleaner-page.js?v=20260729-6";
import { loadGoogleMaps } from "./google-maps-loader.js?v=20260804-1";

const dayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" });
const dayNumFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric" });
const ukCentre = { lat: 52.7, lng: -1.6 };

function renderJobList(bookings) {
  const host = document.querySelector("[data-map-list]");
  if (!host) return;
  host.replaceChildren(...bookings.map((booking) => {
    const card = element("article", "hc-job");
    const top = element("div", "hc-job-top");
    const start = booking.scheduledStartAt ? new Date(booking.scheduledStartAt) : null;
    const valid = start && Number.isFinite(start.getTime());
    const date = element("div", "hc-job-date");
    date.append(
      element("span", "hc-job-day", valid ? dayFormat.format(start).toUpperCase() : "TBC"),
      element("span", "hc-job-dnum", valid ? dayNumFormat.format(start) : "—")
    );
    const head = element("div", "hc-job-head");
    const title = element("a", "hc-job-title", booking.cleaningType || "Cleaning");
    title.href = `/cleaner/jobs/${booking.bookingId}`;
    head.append(title, element("p", "hc-job-addr", booking.propertyArea || "Area shared after confirmation"));
    const chips = element("div", "hc-job-chips");
    chips.append(element("span", "hc-chip", bookingSummaryStatusLabels[booking.status] || "Booking"));
    head.append(chips);
    const pay = element("div", "hc-job-pay");
    pay.append(element("div", "hc-job-pay-amount", formatBookingMoney(booking.pricePence)));
    top.append(date, head, pay);
    card.append(top);
    return card;
  }));
}

function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This device does not support location."));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 });
  });
}

async function initialiseMap(bookings) {
  const configResult = await requestJson("/api/marketplace/maps/config");
  const maps = await loadGoogleMaps(configResult.maps);
  const [{ Map }, { Geocoder }] = await Promise.all([maps.importLibrary("maps"), maps.importLibrary("geocoding")]);
  const host = document.querySelector("[data-google-map]");
  if (!host) throw new Error("The jobs map could not be opened.");
  const mapOptions = { center: ukCentre, zoom: 6, streetViewControl: false, mapTypeControl: false, fullscreenControl: true };
  if (configResult.maps.mapId) mapOptions.mapId = configResult.maps.mapId;
  const map = new Map(host, mapOptions);
  const geocoder = new Geocoder();
  const bounds = new maps.LatLngBounds();
  const areas = [...new Set(bookings.map((booking) => String(booking.propertyArea || "").trim()).filter(Boolean))];
  let plotted = 0;
  const markers = [];

  for (const area of areas) {
    try {
      const result = await geocoder.geocode({ address: `${area}, United Kingdom`, componentRestrictions: { country: "GB" }, region: "GB" });
      const location = result.results?.[0]?.geometry?.location;
      if (!location) continue;
      const areaBookings = bookings.filter((booking) => String(booking.propertyArea || "").trim() === area);
      const marker = new maps.Marker({ map, position: location, title: `${area} · ${areaBookings.length} job${areaBookings.length === 1 ? "" : "s"}` });
      const content = document.createElement("div");
      const heading = document.createElement("strong");
      heading.textContent = area;
      const copy = document.createElement("p");
      copy.textContent = `${areaBookings.length} pending or confirmed job${areaBookings.length === 1 ? "" : "s"} in this approximate area.`;
      content.append(heading, copy);
      const info = new maps.InfoWindow({ content });
      marker.addListener("click", () => info.open({ map, anchor: marker }));
      markers.push(marker);
      bounds.extend(location);
      plotted += 1;
    } catch {
      // A job remains safely listed when Google cannot resolve its shared area.
    }
  }

  if (plotted > 0) map.fitBounds(bounds, 64);
  setText("[data-map-count]", String(plotted));
  const loading = document.querySelector("[data-map-loading]");
  if (loading) loading.hidden = true;
  const controls = document.querySelector("[data-map-controls]");
  if (controls) controls.hidden = false;

  document.querySelector("[data-map-fit]")?.addEventListener("click", () => {
    if (plotted > 0) map.fitBounds(bounds, 64);
    else map.setOptions({ center: ukCentre, zoom: 6 });
  });
  document.querySelector("[data-map-location]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Finding you…";
    try {
      const position = await currentPosition();
      const point = { lat: position.coords.latitude, lng: position.coords.longitude };
      const marker = new maps.Marker({ map, position: point, title: "Your current location", icon: { path: maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#1a73e8", fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 3 } });
      markers.push(marker);
      map.panTo(point);
      map.setZoom(Math.max(map.getZoom() || 6, 12));
      button.textContent = "Location shown";
    } catch (error) {
      button.textContent = error?.code === 1 ? "Location blocked" : "Location unavailable";
    } finally {
      button.disabled = false;
    }
  });
}

createCleanerPage("map", async () => {
  const result = await requestJson("/api/marketplace/bookings?limit=50");
  const bookings = Array.isArray(result.bookings) ? result.bookings : [];
  const buckets = bookingSummaryBuckets(bookings, "cleaner");
  const visible = [...buckets.pending, ...buckets.active, ...buckets.upcoming];
  const plottable = visible.filter((booking) => String(booking.propertyArea || "").trim());
  renderJobList(visible);
  const empty = document.querySelector("[data-map-empty]");
  if (empty) empty.hidden = visible.length > 0;
  try {
    await initialiseMap(plottable);
  } catch (error) {
    const loadingCopy = document.querySelector("[data-map-loading-copy]");
    if (loadingCopy) loadingCopy.textContent = `${error.message || "Google Maps could not be loaded."} Your jobs are still listed below.`;
    setText("[data-map-count]", "0");
  }
});

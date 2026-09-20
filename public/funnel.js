// The visitor half of the conversion funnel.
//
// Homle's analytics are first-party and cookieless (DECISIONS.md D11). This
// module is the only thing that sends them, and it is written so that the
// privacy properties are visible in one screen rather than promised in a
// policy:
//
//   * it reads no cookie and writes no cookie, and stores nothing in
//     localStorage or sessionStorage, so there is no visitor identifier to
//     leak -- which is exactly why no consent banner is required;
//   * it never sends `location.href`, `location.pathname`, `document.referrer`
//     or any query string. "Where" is one name from a fixed list, declared by
//     the page in `data-funnel-surface`;
//   * it sends no element text, no form value and no free text of any kind.
//
// The server checks all of this again against the same allowlist, and the
// database checks it a third time in migration 124. Three copies of a list is
// the price of a guarantee that does not depend on anybody remembering.

// Mirrors `src/marketplace/funnel-telemetry.mjs`. Duplicated rather than
// imported because the browser must not fetch a server module, and kept short
// enough to read: a name that is not here is dropped before it leaves the page.
const metrics = new Set([
  "funnel.landing.viewed",
  "funnel.landing.cta",
  "funnel.signup.started",
  "funnel.signup.completed",
  "funnel.property.added",
  "funnel.scan.completed",
  "funnel.price.shown",
  "funnel.slot.chosen",
  "funnel.payment.authorised"
]);
const audiences = new Set(["customer", "landlord", "agent", "cleaner", "unknown"]);
const surfaces = new Set(["landing", "for-landlords", "pricing", "signup", "app"]);

const endpoint = "/api/marketplace/funnel-events";
const maximumQueue = 40;
const flushDelayMs = 1500;

const queue = [];
let timer = null;

function pageDefaults() {
  const data = document.body?.dataset || {};
  return {
    audience: audiences.has(data.funnelAudience) ? data.funnelAudience : "unknown",
    surface: surfaces.has(data.funnelSurface) ? data.funnelSurface : ""
  };
}

function send(events) {
  // Fire-and-forget, and deliberately unreported. A visitor's page must never
  // slow down, block or show an error because a counter did not arrive.
  try {
    void fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events }),
      // Survives the page being closed, which is when the most interesting
      // event -- the one where somebody leaves -- is sent.
      keepalive: true,
      credentials: "omit",
      cache: "no-store"
    }).catch(() => {});
  } catch { /* A browser without fetch simply goes uncounted. */ }
}

function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!queue.length) return;
  send(queue.splice(0, queue.length));
}

/**
 * Count one step of the funnel.
 *
 * Silently ignores anything outside the vocabulary above, because a mistyped
 * metric name is not worth an exception on somebody's booking page.
 */
export function recordFunnel(metric, dimensions = {}) {
  if (!metrics.has(metric) || queue.length >= maximumQueue) return false;
  const defaults = pageDefaults();
  const audience = audiences.has(dimensions.audience) ? dimensions.audience : defaults.audience;
  const surface = surfaces.has(dimensions.surface) ? dimensions.surface : defaults.surface;
  const event = { metric, count: 1, dimensions: { audience } };
  if (surface) event.dimensions.surface = surface;
  queue.push(event);
  if (queue.length >= 20) { flush(); return true; }
  if (!timer) timer = setTimeout(flush, flushDelayMs);
  return true;
}

function start() {
  // The flush hooks are attached unconditionally, because a page that records
  // nothing automatically may still call `recordFunnel` from its own module --
  // a completed signup, an authorised payment -- and those are precisely the
  // events followed immediately by a navigation. Without this, the most
  // valuable end of the funnel would be the part most often lost.
  //
  // `pagehide` rather than `unload`, which prevents the back/forward cache.
  // `visibilitychange` covers the phone case, where a tab is backgrounded and
  // never formally hidden again.
  addEventListener("pagehide", flush);
  addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });

  // A page opts into automatic counting by declaring its surface. One that has
  // not -- because the same document serves several journeys, and a page view
  // could not be attributed honestly -- records only what its own code asks
  // for.
  const { surface } = pageDefaults();
  if (!surface) return;
  recordFunnel("funnel.landing.viewed");
  document.addEventListener("click", (event) => {
    // `closest` from the event target, so a click on a label or icon inside the
    // button still counts. Only the declared marker is read -- never the
    // element's text, href or id.
    const marker = event.target?.closest?.("[data-funnel-cta]");
    if (marker) recordFunnel("funnel.landing.cta", { audience: marker.dataset.funnelAudience });
  }, { passive: true });
}

if (document.readyState === "loading") addEventListener("DOMContentLoaded", start, { once: true });
else start();

// The administrator navigation — built here, once, for all eleven desks.
//
// Each desk hard-coded its own list inside `[data-admin-private-navigation]`,
// and the eleven copies had drifted into nine different shapes: between three
// and seven destinations, in different orders, with different labels for the
// same page. `/admin/scan-operations` appeared in ONE of them and was linked
// from nowhere else in the product, so an operator could only reach it by
// typing the URL. `/admin/support` offered three links and was the only desk
// that did not load the navigation script at all.
//
// This is the same fault the Cleaner sidebar had, with the same fix: one list,
// rendered into whatever container the page provides, replacing what it shipped.
// A desk that is added to `adminDestinations` appears on every other desk the
// same day, rather than on whichever ones somebody remembered to edit.

import { adminNavigationVerdict } from "./admin-navigation-decision.js?v=20260831-1";

export const adminDestinations = Object.freeze([
  { href: "/admin", label: "Control desk" },
  { href: "/admin/bookings", label: "Booking operations" },
  { href: "/admin/cases", label: "Cases" },
  { href: "/admin/support", label: "Landlord support" },
  { href: "/admin/verifications", label: "Cleaner vetting" },
  { href: "/admin/coverage", label: "Coverage" },
  { href: "/admin/funnel", label: "Funnel" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/pricing", label: "Pricing" },
  { href: "/admin/scan-pricing", label: "Scan pricing" },
  { href: "/admin/scan-operations", label: "Scan operations" }
]);

/**
 * Builds the navigation into `container`, marking `currentPath` as current.
 *
 * Exported separately from the DOM work below so a test can run it without a
 * browser, and so the list has one owner rather than eleven.
 */
export function renderAdminNavigation(container, currentPath = "") {
  if (!container) return;
  const badge = document.createElement("span");
  badge.className = "admin-badge";
  badge.textContent = "Administrator account";

  const links = adminDestinations.map((destination) => {
    const link = document.createElement("a");
    link.className = "back-link";
    link.href = destination.href;
    link.textContent = destination.label;
    // Exact match only. `/admin` is a prefix of every other desk, so a
    // startsWith test would mark the control desk current on all eleven.
    if (destination.href === currentPath) {
      link.classList.add("is-current");
      link.setAttribute("aria-current", "page");
    }
    return link;
  });

  container.replaceChildren(badge, ...links);
}

const container = document.querySelector("[data-admin-private-navigation]");

if (container) {
  container.hidden = true;
  renderAdminNavigation(container, location.pathname.replace(/\/+$/, "") || "/admin");

  // Asked here rather than mirrored from `[data-admin-private-workspace]`.
  //
  // The strip used to copy that element's `hidden`, which conflated two
  // different things: "you are not an administrator" and "this desk's data did
  // not load". Measured signed in as a real administrator, /admin/payments
  // (payments unconfigured, 404) and /admin/pricing (a 403 on its preview call)
  // hid the whole strip — so the one screen an operator most needs to leave was
  // the one screen with no way out but the URL bar. The navigation answers to
  // the role, and a desk that cannot show its data still lets you reach the ten
  // that can.
  (async () => {
    let result;
    try {
      const response = await fetch("/api/marketplace/account", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" }
      });
      try {
        result = { status: response.status, account: (await response.json())?.account };
      } catch {
        result = { status: response.status, malformed: true };
      }
    } catch {
      result = { failed: true };
    }
    const verdict = adminNavigationVerdict(result);
    if (verdict === "reveal") container.hidden = false;
    else if (verdict === "remove") container.replaceChildren();
  })();
}

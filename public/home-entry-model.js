export function homeEntryMode(health) {
  const marketplace = health?.ok === true && health?.service === "tideway-marketplace" && health.marketplace && typeof health.marketplace === "object"
    ? health.marketplace
    : null;
  if (marketplace?.enabled === true && marketplace?.ready === true && marketplace?.authenticationReady === true) return "account";
  return marketplace?.authenticationReady === true ? "authentication" : "concierge";
}

export function homeEntryPresentation(mode) {
  if (mode === "account") return Object.freeze({
    bookingPath: "/signup?intent=book",
    bookingLabel: "Book a clean",
    cleanerPath: "/cleaners",
    stepCopy: "Sign in and choose your property, date and type of clean.",
    statusCopy: "Creating a request does not confirm a Cleaner or take payment. You review the scope and quote first.",
    accountAccess: true
  });
  if (mode === "authentication") return Object.freeze({
    bookingPath: "/request",
    bookingLabel: "Request a clean",
    cleanerPath: "/request",
    stepCopy: "Tell Homle what needs cleaning and when you need it.",
    statusCopy: "Approved testers can sign in. Cleaning requests remain guided until marketplace testing is enabled.",
    accountAccess: true
  });
  return Object.freeze({
    bookingPath: "/request",
    bookingLabel: "Request a clean",
    cleanerPath: "/request",
    stepCopy: "Tell Homle what needs cleaning and when you need it.",
    statusCopy: "Homle is accepting guided pilot requests. Coverage, Cleaner availability and price are confirmed before any booking.",
    accountAccess: false
  });
}

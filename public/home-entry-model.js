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
    cleanerPath: "/cleaner/onboarding",
    directoryPath: "/landlord/dashboard",
    stepCopy: "Sign in and choose your property, date and type of clean.",
    statusCopy: "Creating a request does not confirm a Cleaner or take payment. You review the scope and quote first.",
    accountAccess: true
  });
  if (mode === "authentication") return Object.freeze({
    bookingPath: "/signup?intent=book",
    bookingLabel: "Create Landlord profile",
    cleanerPath: "/cleaner/onboarding",
    directoryPath: "/landlord/dashboard",
    stepCopy: "Create a Landlord profile, then add the property when marketplace testing opens.",
    statusCopy: "Approved testers can create either a Landlord or Cleaner profile. Booking services remain closed until the full marketplace rehearsal passes.",
    accountAccess: true
  });
  return Object.freeze({
    bookingPath: "/signup?intent=book",
    bookingLabel: "Create Landlord profile",
    cleanerPath: "/cleaner/onboarding",
    directoryPath: "/landlord/dashboard",
    stepCopy: "Create your secure account, then manage the whole cleaning journey from your dashboard.",
    statusCopy: "Landlords and Cleaners now use their separate private dashboards.",
    accountAccess: true
  });
}

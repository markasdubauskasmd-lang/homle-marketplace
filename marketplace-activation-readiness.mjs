const requirementDefinitions = Object.freeze([
  {
    key: "privateDataStorage",
    label: "Private data location",
    missing: "Move local private records outside cloud-synchronised folders",
    complete: (state) => state.privateDataStorageSafe === true
  },
  {
    key: "accountAccess",
    label: "Account service attachment",
    missing: "Connect and verify account email delivery, sessions and the restricted database",
    complete: (state) => state.authenticationReady === true
      && ((state.providers?.emailPassword === true
        && state.providers?.emailVerification === true
        && state.providers?.passwordReset === true)
        || state.providers?.google === true)
  },
  {
    key: "socialSignIn",
    label: "Social provider attachment",
    missing: "Create and attach the real Homle Google OAuth web client; add Facebook after Google works",
    complete: (state) => state.providers?.google === true || state.providers?.facebook === true
  },
  {
    key: "marketplaceServices",
    label: "Managed booking database",
    missing: "Verify the restricted managed booking database and marketplace runtime",
    complete: (state) => state.marketplaceEnabled === true && state.marketplaceReady === true
  },
  {
    key: "privateMedia",
    label: "Private room media",
    missing: "Attach and verify private room photo/video storage",
    complete: (state) => state.mediaReady === true
  },
  {
    key: "transactionalEmail",
    label: "Transactional email",
    missing: "Attach and verify transactional account and booking email delivery",
    complete: (state) => state.emailReady === true
  },
  {
    key: "realtimeUpdates",
    label: "Real-time booking updates",
    missing: "Attach and verify the dedicated real-time PostgreSQL connection",
    complete: (state) => state.realtimeReady === true
  },
  {
    key: "postcodeGeocoding",
    label: "Postcode distance matching",
    missing: "Attach and verify postcode geocoding for real-distance Cleaner matching",
    complete: (state) => state.geocodingReady === true
  },
  {
    key: "matchingPricing",
    label: "Cleaner matching and pricing",
    missing: "Configure and verify the complete founder-approved private booking pricing policy",
    complete: (state) => state.matchingReady === true
  },
  {
    key: "payments",
    label: "Test payment service",
    missing: "Attach the approved test-only payment service",
    complete: (state) => state.paymentsReady === true
  },
  {
    key: "productionSafety",
    label: "Production safety mode",
    missing: "Run the final HTTPS deployment in production mode with every local demo surface disabled",
    complete: (state) => state.productionMode === true && state.localDemosEnabled !== true
  }
]);

export function marketplaceActivationReadiness(input = {}) {
  const providers = input.providers && typeof input.providers === "object" ? input.providers : {};
  const state = { ...input, providers };
  const requirements = requirementDefinitions.map((definition) => ({
    key: definition.key,
    label: definition.label,
    complete: definition.complete(state),
    missing: definition.missing
  }));
  const checks = Object.fromEntries(requirements.map((requirement) => [requirement.key, requirement.complete]));
  const missing = Object.fromEntries(requirements.map((requirement) => [requirement.key, requirement.complete ? [] : [requirement.missing]]));
  const completed = requirements.filter((requirement) => requirement.complete).length;
  const next = requirements.find((requirement) => !requirement.complete) || null;
  return Object.freeze({
    completed,
    total: requirements.length,
    ready: completed === requirements.length,
    checks: Object.freeze(checks),
    missing: Object.freeze(missing),
    next: next ? Object.freeze({ key: next.key, label: next.label, action: next.missing }) : null
  });
}

/*
 * The Cleaner onboarding model from the supplied design.
 *
 * Step keys, order and titles are transcribed from the design's own STEPS/TITLES
 * tables so the sidebar and the progress chips match it exactly.
 *
 * `derive` is the honest part. Homle records only some of these today, so each step
 * declares how — or whether — its completion can be established from real account
 * data. A step with `derive: null` has no backing store anywhere in this codebase and
 * always reads as outstanding; it is never marked complete to make the bar look
 * healthier, and never marked verified when Homle holds no such record.
 */

export const onboardingSteps = [
  { key: "personal", title: "Personal details", icon: "user", sidebar: true, href: "/cleaner/profile",
    derive: (d) => Boolean(d.account?.displayName && d.account?.email) },
  { key: "identity", title: "Identity verification", icon: "id", sidebar: true, href: "/cleaner/profile",
    derive: (d) => d.profile?.identityCheckStatus === "verified" },
  { key: "rtw", title: "Right to work", icon: "folder", sidebar: false, href: "", derive: null },
  { key: "dbs", title: "Background checks (DBS)", icon: "shield", sidebar: true, href: "/cleaner/profile",
    derive: (d) => d.profile?.backgroundCheckStatus === "verified" },
  { key: "business", title: "Business details", icon: "brief", sidebar: true, href: "", derive: null },
  { key: "tax", title: "Tax & self-employment", icon: "folder", sidebar: false, href: "", derive: null },
  { key: "experience", title: "Cleaning experience", icon: "star", sidebar: true, href: "/cleaner/profile",
    derive: (d) => Number.isFinite(d.profile?.yearsExperience) },
  { key: "references", title: "References", icon: "users", sidebar: true, href: "", derive: null },
  { key: "insurance", title: "Insurance", icon: "umb", sidebar: true, href: "", derive: null },
  { key: "banking", title: "Banking & payments", icon: "card", sidebar: false, href: "/cleaner/payouts",
    derive: (d) => d.payoutState === "ready" },
  { key: "equipment", title: "Equipment", icon: "box", sidebar: false, href: "/cleaner/profile",
    derive: (d) => (d.profile?.equipmentSupplied?.length || 0) + (d.profile?.productsSupplied?.length || 0) > 0 },
  { key: "transport", title: "Transport", icon: "truck", sidebar: false, href: "", derive: null },
  { key: "availability", title: "Availability", icon: "cal", sidebar: false, href: "/cleaner/availability",
    derive: (d) => (d.availabilityCount || 0) > 0 },
  { key: "areas", title: "Work areas", icon: "pin", sidebar: true, href: "/cleaner/availability",
    derive: (d) => (d.profile?.serviceAreas?.length || 0) > 0 },
  { key: "languages", title: "Languages", icon: "lang", sidebar: false, href: "/cleaner/profile",
    derive: (d) => (d.profile?.languages?.length || 0) > 0 },
  { key: "skills", title: "Skills", icon: "spark", sidebar: false, href: "", derive: null },
  { key: "training", title: "Training & certificates", icon: "award", sidebar: false, href: "", derive: null },
  { key: "compliance", title: "Compliance & declarations", icon: "pen", sidebar: false, href: "", derive: null }
];

/*
 * The design's ONBOARDING and ACCOUNT sidebar groups.
 *
 * This is deliberately a separate list from `onboardingSteps` above, because the design
 * treats them separately: the sidebar uses shorter labels ("Banking", "Contracts"), adds
 * a Documents entry that is not a progress step, and omits Right to work, Tax, Transport
 * and Skills, which appear only as progress chips.
 *
 * `step` links an entry to a step key so its tick reflects real completion. An entry with
 * no `step` has nothing to derive from and shows an outstanding dot.
 */
export const onboardingNav = [
  { label: "Personal Details", icon: "user", step: "personal", href: "/cleaner/profile" },
  { label: "Business Details", icon: "brief", step: "business", href: "" },
  { label: "Identity Verification", icon: "id", step: "identity", href: "/cleaner/profile" },
  { label: "Background Checks", icon: "shield", step: "dbs", href: "/cleaner/profile" },
  { label: "Work Areas", icon: "pin", step: "areas", href: "/cleaner/availability" },
  { label: "Experience", icon: "star", step: "experience", href: "/cleaner/profile" },
  { label: "References", icon: "users", step: "references", href: "" },
  { label: "Insurance", icon: "umb", step: "insurance", href: "" },
  { label: "Banking", icon: "card", step: "banking", href: "/cleaner/payouts" },
  { label: "Availability", icon: "cal", step: "availability", href: "/cleaner/availability" },
  { label: "Equipment", icon: "box", step: "equipment", href: "/cleaner/profile" },
  { label: "Documents", icon: "folder", step: "", href: "" },
  { label: "Training", icon: "award", step: "training", href: "" },
  { label: "Contracts", icon: "pen", step: "compliance", href: "" }
];

export const accountNav = [
  { label: "My Profile", icon: "user", href: "/cleaner/profile" },
  { label: "Messages", icon: "chat", href: "/notifications", notificationHook: true },
  { label: "Public profile", icon: "id", href: "/cleaner/profile/preview" },
  { label: "Public directory", icon: "dash", href: "/cleaners" }
];

// Icon paths transcribed from the design's ICONS table.
export const onboardingIcons = {
  dash: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  reg: "M9 3h6v4H9zM15 5h4v16H5V5h4M9 12h6M9 16h4",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5",
  brief: "M4 8h16v12H4zM9 8V5h6v3M4 13h16",
  id: "M3 6h18v13H3zM7 11a2 2 0 1 0 4 0 2 2 0 0 0-4 0M6 15.5c.7-1.3 1.8-2 3-2s2.3.7 3 2M15 10h4M15 13h3",
  shield: "M12 3l8 3v6c0 4.5-3.5 7.5-8 9-4.5-1.5-8-4.5-8-9V6zM9 12l2 2 4-4",
  pin: "M12 21c-4-4-7-7.5-7-11a7 7 0 0 1 14 0c0 3.5-3 7-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  star: "M12 3l2.7 5.7 6.3.9-4.5 4.4 1 6.3-5.5-3-5.5 3 1-6.3L3 9.6l6.3-.9z",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c1.2-3 3.7-4.5 6.5-4.5s5.3 1.5 6.5 4.5M16 4.5a3.5 3.5 0 0 1 0 6.6M17.5 15.7c2 .7 3.4 2 4 4.3",
  umb: "M12 3v1M3 13a9 9 0 0 1 18 0H3zM12 13v5a2.5 2.5 0 0 0 5 0",
  card: "M3 7h18v12H3zM3 11h18M6 15h4",
  cal: "M4 6h16v15H4zM4 10h16M8 3v5M16 3v5",
  box: "M5 8h14l-1.5 13h-11zM9 8a3 3 0 0 1 6 0",
  folder: "M3 5h6l2 3h10v12H3zM3 8h8",
  award: "M12 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM9 13l-1.5 7L12 17.5 16.5 20 15 13",
  pen: "M4 20l1-4L16 5l3 3L8 19zM13 8l3 3",
  bell: "M6 16v-5a6 6 0 1 1 12 0v5l2 3H4zM10 19a2 2 0 0 0 4 0",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1",
  chat: "M4 5h16v11H9l-5 4zM8 9h8M8 12h5",
  truck: "M2 7h12v9H2zM14 10h4l3 3v3h-7zM6 19a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM17 19a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z",
  pound: "M15 5.5A4 4 0 0 0 9 9v6c0 2-.8 3-2.5 4H17M7 12h6",
  lang: "M4 5h9M8.5 3v2M11 5c-1 4-4 7-7 9M6 8c1.5 3 4 5.5 7 6.5M13 20l4-9 4 9M14.5 17h5",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9z"
};

export function onboardingProgress(data) {
  const steps = onboardingSteps.map((step) => ({
    ...step,
    // A step Homle cannot record is reported as outstanding, never as done.
    done: typeof step.derive === "function" ? step.derive(data) === true : false,
    tracked: typeof step.derive === "function"
  }));
  const done = steps.filter((step) => step.done).length;
  return {
    steps,
    doneCount: done,
    totalCount: steps.length,
    remaining: steps.length - done,
    percent: Math.round(done / steps.length * 100)
  };
}

// Mirrors the design's applicationStatus chip. Derived from what Homle actually knows
// about the profile rather than a separate application-state machine, which does not exist.
export function applicationStatusLabel(data, progress) {
  if (data.profile?.isPublic === true) return "Approved";
  if (progress.percent === 100) return "Submitted";
  if (progress.doneCount === 0) return "Draft";
  return "Draft";
}

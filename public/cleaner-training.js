import { createCleanerPage, element } from "./cleaner-page.js?v=20260729-6";

const trainingModules = [
  { category: "Required", lessons: 6, minutes: 45, title: "COSHH — safe use of chemicals", description: "Labels, dilution, storage and what to do after a spill. Required before commercial contracts." },
  { category: "Required", lessons: 4, minutes: 30, title: "Manual handling", description: "Lifting, carrying and moving furniture without injuring your back." },
  { category: "Required", lessons: 5, minutes: 40, title: "Safeguarding & vulnerable clients", description: "Spotting and reporting concerns when cleaning for elderly or vulnerable people." },
  { category: "Safety", lessons: 4, minutes: 25, title: "Lone working & personal safety", description: "Check-in routines, key handling and leaving a property safely." },
  { category: "Specialism", lessons: 7, minutes: 50, title: "Eco cleaning specialist", description: "Low-tox products and methods for safer, lower-impact cleaning." },
  { category: "Specialism", lessons: 7, minutes: 50, title: "Deep cleaning specialist", description: "Top-to-bottom resets: build-up, grime and the rooms regular cleans skip." },
  { category: "Specialism", lessons: 8, minutes: 60, title: "End of tenancy masterclass", description: "Deposit-ready standards, landlord checklists and photo evidence." },
  { category: "Specialism", lessons: 5, minutes: 35, title: "Airbnb turnover pro", description: "Hotel-style beds, welcome setups and 90-minute turnarounds." },
  { category: "Safety", lessons: 6, minutes: 55, title: "Emergency first aid basics", description: "First-response basics for the first five minutes." },
  { category: "Business", lessons: 9, minutes: 70, title: "Running your cleaning business", description: "Pricing, tax, invoicing and keeping regulars happy." },
  { category: "Safety", lessons: 5, minutes: 35, title: "Food hygiene essentials", description: "Cross-contamination, allergens and fridge safety for clients who cook." },
  { category: "Specialism", lessons: 6, minutes: 45, title: "Safe cleaning of carpets", description: "Fibre types, stain science and the machines that get it wrong if misused." },
  { category: "Specialism", lessons: 5, minutes: 30, title: "Child safe cleaning", description: "Products, storage and conduct for homes with young children." },
  { category: "Specialism", lessons: 6, minutes: 45, title: "Commercial cleaning", description: "Offices, shops and shared buildings — schedules, access and site rules." },
  { category: "Specialism", lessons: 6, minutes: 40, title: "Move in/out cleaning", description: "Cleaning around boxes, movers and a family’s day-one or day-last chaos." },
  { category: "Specialism", lessons: 5, minutes: 35, title: "Window cleaning", description: "Streak-free interiors, safe reach for exteriors, and when to say no to heights." },
  { category: "Specialism", lessons: 5, minutes: 35, title: "Oven cleaning", description: "Baked-on carbon, safe caustic use, and getting glass and racks like new." },
  { category: "Safety", lessons: 6, minutes: 45, title: "Biohazard cleaning", description: "Bodily fluids, sharps and PPE — and knowing exactly when to refuse a job." },
  { category: "Specialism", lessons: 6, minutes: 40, title: "Elderly care cleaning", description: "Mobility, dignity and safety when your client is older or frail." },
  { category: "Business", lessons: 5, minutes: 30, title: "Customer service basics", description: "Communication, handling complaints and turning one-off clients into regulars." },
  { category: "Safety", lessons: 5, minutes: 30, title: "Data protection & GDPR", description: "Client details, photos and messages — handled the way UK law requires." },
  { category: "Safety", lessons: 5, minutes: 25, title: "Health & safety refresher", description: "The everyday hazards on every job — slips, electrics, ladders and PPE." },
  { category: "Safety", lessons: 5, minutes: 25, title: "Handling keys & lockboxes", description: "Labelling, storage, lockbox codes and what to do the moment a key goes missing." },
  { category: "Business", lessons: 5, minutes: 35, title: "Working with property managers", description: "Scope, reports and invoicing when a letting agent — not the homeowner — is your client." },
  { category: "Business", lessons: 5, minutes: 30, title: "Handling client complaints", description: "Formal disputes, evidence, refunds and Homle’s resolution process, step by step." },
  { category: "Business", lessons: 4, minutes: 20, title: "Uniform & appearance", description: "Presentation, hygiene and the small things clients notice before you’ve cleaned a thing." },
  { category: "Safety", lessons: 4, minutes: 25, title: "Pest awareness", description: "Spotting the signs early, staying safe, and knowing when to call in professional pest control." },
  { category: "Business", lessons: 4, minutes: 25, title: "Time management", description: "Buffers, batching by area and the habits that stop one late job wrecking your whole day." },
  { category: "Specialism", lessons: 4, minutes: 30, title: "Ironing & laundry service", description: "Fabric care, safe machine use and ironing that actually saves clients time." },
  { category: "Specialism", lessons: 4, minutes: 30, title: "Odour removal", description: "Finding the real source of a smell and treating it properly, not just masking it." },
  { category: "Business", lessons: 4, minutes: 25, title: "Sustainability practices", description: "Waste, water, travel and packaging — running a lower-impact business clients notice." },
  { category: "Specialism", lessons: 4, minutes: 25, title: "Balcony & outdoor cleaning", description: "Decking, railings and pots — cleaning outdoor space safely without damaging it." },
  { category: "Specialism", lessons: 4, minutes: 25, title: "Handling pets on site", description: "Staying safe around clients’ animals and cleaning pet mess without harm." },
  { category: "Specialism", lessons: 4, minutes: 25, title: "Silverware & antiques care", description: "Handling valuables and heirlooms without damaging or losing client trust." }
];

if (trainingModules.length !== 34) throw new Error("The Academy catalogue must contain all 34 modules shown in the supplied design.");
const activeTrainingModules = trainingModules.filter((module) => module.category === "Required");
if (activeTrainingModules.length !== 3) throw new Error("The Academy must keep exactly three required modules active for now.");

function renderModule(module, showFeedback) {
  const card = element("article", "hc-academy-card");
  card.dataset.trainingCategory = module.category.toLowerCase();
  const active = module.category === "Required";
  card.classList.toggle("is-inactive", !active);

  const metadata = element("div", "hc-academy-card-meta");
  metadata.append(
    element("span", `hc-academy-tag is-${module.category.toLowerCase()}`, module.category),
    element("small", "", `${module.lessons} lessons · ${module.minutes} min`)
  );

  const title = element("h2", "", module.title);
  const description = element("p", "", module.description);
  const actions = element("div", "hc-academy-card-actions");
  const start = element("button", "", active ? "Start course ↗" : "Inactive");
  start.type = "button";
  start.disabled = !active;
  start.setAttribute("aria-disabled", String(!active));
  if (active) {
    start.addEventListener("click", () => {
      showFeedback(`“${module.title}” is not available yet. Nothing was started, completed or recorded.`, "error");
      document.querySelector("[data-training-feedback]")?.focus();
    });
  }
  actions.append(start, element("small", "", active ? "Course preview" : "Temporarily inactive"));
  card.append(metadata, title, description, actions);
  return card;
}

createCleanerPage("training", async ({ showFeedback }) => {
  const grid = document.querySelector("[data-training-modules]");
  const resultStatus = document.querySelector("[data-training-result-status]");
  const filterButtons = [...document.querySelectorAll("[data-training-filter]")];

  function showModules(filter = "required") {
    const visible = filter === "required" ? activeTrainingModules : [];
    grid?.replaceChildren(...visible.map((module) => renderModule(module, showFeedback)));
    if (resultStatus) resultStatus.textContent = `${visible.length} active required modules shown. Other catalogue modules are temporarily inactive.`;
  }

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const filter = button.dataset.trainingFilter || "all";
      filterButtons.forEach((candidate) => {
        const current = candidate === button;
        candidate.classList.toggle("is-current", current);
        candidate.setAttribute("aria-pressed", String(current));
      });
      showModules(filter);
    });
  });

  document.querySelector("[data-training-start]")?.addEventListener("click", () => {
    showFeedback("COSHH course delivery and progress tracking are not connected yet. Nothing was started or recorded.", "error");
    document.querySelector("[data-training-feedback]")?.focus();
  });

  showModules("required");
});

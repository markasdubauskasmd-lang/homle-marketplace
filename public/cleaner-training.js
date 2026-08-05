import { createCleanerPage, element } from "./cleaner-page.js?v=20260729-6";

const cleanerModules = [
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
  { category: "Specialism", lessons: 6, minutes: 40, title: "Move in/out cleaning", description: "Cleaning around boxes, movers and a family's day-one or day-last chaos." },
  { category: "Specialism", lessons: 5, minutes: 35, title: "Window cleaning", description: "Streak-free interiors, safe reach for exteriors, and when to say no to heights." },
  { category: "Specialism", lessons: 5, minutes: 35, title: "Oven cleaning", description: "Baked-on carbon, safe caustic use, and getting glass and racks like new." },
  { category: "Safety", lessons: 6, minutes: 45, title: "Biohazard cleaning", description: "Bodily fluids, sharps and PPE — and knowing exactly when to refuse a job." },
  { category: "Specialism", lessons: 6, minutes: 40, title: "Elderly care cleaning", description: "Mobility, dignity and safety when your client is older or frail." },
  { category: "Business", lessons: 5, minutes: 30, title: "Customer service basics", description: "Communication, handling complaints and turning one-off clients into regulars." },
  { category: "Safety", lessons: 5, minutes: 30, title: "Data protection & GDPR", description: "Client details, photos and messages — handled the way UK law requires." },
  { category: "Safety", lessons: 5, minutes: 25, title: "Health & safety refresher", description: "The everyday hazards on every job — slips, electrics, ladders and PPE." },
  { category: "Safety", lessons: 5, minutes: 25, title: "Handling keys & lockboxes", description: "Labelling, storage, lockbox codes and what to do the moment a key goes missing." },
  { category: "Business", lessons: 5, minutes: 35, title: "Working with property managers", description: "Scope, reports and invoicing when a letting agent — not the homeowner — is your client." },
  { category: "Business", lessons: 5, minutes: 30, title: "Handling client complaints", description: "Formal disputes, evidence, refunds and Homle's resolution process, step by step." },
  { category: "Business", lessons: 4, minutes: 20, title: "Uniform & appearance", description: "Presentation, hygiene and the small things clients notice before you've cleaned a thing." },
  { category: "Safety", lessons: 4, minutes: 25, title: "Pest awareness", description: "Spotting the signs early, staying safe, and knowing when to call in professional pest control." },
  { category: "Business", lessons: 4, minutes: 25, title: "Time management", description: "Buffers, batching by area and the habits that stop one late job wrecking your whole day." },
  { category: "Specialism", lessons: 4, minutes: 30, title: "Ironing & laundry service", description: "Fabric care, safe machine use and ironing that actually saves clients time." },
  { category: "Specialism", lessons: 4, minutes: 30, title: "Odour removal", description: "Finding the real source of a smell and treating it properly, not just masking it." },
  { category: "Business", lessons: 4, minutes: 25, title: "Sustainability practices", description: "Waste, water, travel and packaging — running a lower-impact business clients notice." },
  { category: "Specialism", lessons: 4, minutes: 25, title: "Balcony & outdoor cleaning", description: "Decking, railings and pots — cleaning outdoor space safely without damaging it." },
  { category: "Specialism", lessons: 4, minutes: 25, title: "Handling pets on site", description: "Staying safe around clients' animals and cleaning pet mess without harm." },
  { category: "Specialism", lessons: 4, minutes: 25, title: "Silverware & antiques care", description: "Handling valuables and heirlooms without damaging or losing client trust." }
];

const beauticianModules = [
  { category: "Required", lessons: 7, minutes: 50, title: "Hygiene, sanitation & infection control", description: "Clean tools, work areas and hands correctly before, during and after every appointment." },
  { category: "Required", lessons: 6, minutes: 45, title: "Client consultation & contraindications", description: "Ask the right questions, spot treatment risks and record safe decisions." },
  { category: "Required", lessons: 5, minutes: 40, title: "Safeguarding & vulnerable clients", description: "Recognise concerns and maintain safe professional boundaries with every client." },
  { category: "Required", lessons: 5, minutes: 35, title: "Allergy awareness & patch testing", description: "Use patch tests properly and respond safely to sensitivities and allergic reactions." },
  { category: "Required", lessons: 5, minutes: 35, title: "Professional ethics & client consent", description: "Gain informed consent, protect dignity and keep treatment decisions transparent." },
  { category: "Required", lessons: 6, minutes: 55, title: "First aid for beauty professionals", description: "Immediate care for fainting, burns, cuts and allergic reactions in beauty settings." },
  { category: "Safety", lessons: 6, minutes: 45, title: "COSHH for salons & mobile beauty", description: "Store, label and use beauty chemicals safely in a salon or a client's home." },
  { category: "Safety", lessons: 5, minutes: 35, title: "Electrical beauty equipment safety", description: "Inspect, position and operate electrical tools without creating avoidable hazards." },
  { category: "Safety", lessons: 4, minutes: 30, title: "Wax temperature & burn prevention", description: "Test temperature, protect the skin and know how to respond if a burn occurs." },
  { category: "Safety", lessons: 5, minutes: 35, title: "Nail product chemical safety", description: "Reduce exposure to acrylates, dust and solvents while protecting client health." },
  { category: "Safety", lessons: 4, minutes: 30, title: "Sharps and clinical waste awareness", description: "Handle sharps and contaminated waste safely and use appropriate disposal routes." },
  { category: "Safety", lessons: 4, minutes: 25, title: "Lone working & personal safety", description: "Use check-ins, boundaries and exit plans for mobile and independent appointments." },
  { category: "Safety", lessons: 4, minutes: 25, title: "Manual handling for mobile beauticians", description: "Transport beds, cases and equipment without injuring yourself or damaging property." },
  { category: "Safety", lessons: 5, minutes: 35, title: "Skin reaction & incident response", description: "Recognise adverse reactions, stop treatment safely and record what happened." },
  { category: "Specialism", lessons: 8, minutes: 60, title: "Facials & skincare fundamentals", description: "Skin types, cleansing, exfoliation and safe treatment planning for facial services." },
  { category: "Specialism", lessons: 8, minutes: 65, title: "Advanced facial treatments", description: "Build on facial fundamentals with advanced techniques, aftercare and risk checks." },
  { category: "Specialism", lessons: 7, minutes: 55, title: "Makeup artistry fundamentals", description: "Preparation, colour, hygiene and lasting application for everyday makeup." },
  { category: "Specialism", lessons: 7, minutes: 55, title: "Bridal makeup specialist", description: "Consultations, trials, photography-ready application and wedding-day planning." },
  { category: "Specialism", lessons: 6, minutes: 45, title: "Brow shaping & tinting", description: "Map, shape and tint brows safely for balanced, client-approved results." },
  { category: "Specialism", lessons: 6, minutes: 45, title: "Lash lift & tint", description: "Safe placement, processing, tinting and aftercare for lifted lashes." },
  { category: "Specialism", lessons: 8, minutes: 65, title: "Classic lash extensions", description: "Isolation, adhesive control, styling and safe removal for classic sets." },
  { category: "Specialism", lessons: 7, minutes: 55, title: "Gel manicure & nail care", description: "Prepare nails, apply gel cleanly and protect natural nail health during removal." },
  { category: "Specialism", lessons: 8, minutes: 65, title: "Acrylic nail fundamentals", description: "Safe preparation, product control, structure, maintenance and removal." },
  { category: "Specialism", lessons: 7, minutes: 55, title: "Waxing techniques", description: "Consult, prepare and wax common treatment areas with safe aftercare." },
  { category: "Specialism", lessons: 7, minutes: 50, title: "Hair styling fundamentals", description: "Prepare, section and style hair while protecting the scalp and hair condition." },
  { category: "Specialism", lessons: 8, minutes: 60, title: "Massage fundamentals", description: "Consultation, positioning, pressure and safe foundational massage techniques." },
  { category: "Specialism", lessons: 6, minutes: 45, title: "Pedicure & foot care", description: "Hygiene, nail care, hard-skin precautions and safe polish application." },
  { category: "Specialism", lessons: 6, minutes: 45, title: "Inclusive beauty for diverse skin tones", description: "Adapt product selection and technique for a broad range of skin tones and needs." },
  { category: "Business", lessons: 9, minutes: 70, title: "Running your beauty business", description: "Pricing, tax, insurance, records and the routines behind a reliable beauty service." },
  { category: "Business", lessons: 5, minutes: 35, title: "Mobile appointment setup", description: "Plan travel, create a hygienic workspace and leave a client's home as you found it." },
  { category: "Business", lessons: 5, minutes: 35, title: "Pricing beauty services", description: "Calculate treatment costs, time and margin without underpricing your work." },
  { category: "Business", lessons: 5, minutes: 30, title: "Client records & GDPR", description: "Protect consultation forms, treatment notes, photos and contact information." },
  { category: "Business", lessons: 5, minutes: 30, title: "Handling complaints & aftercare", description: "Set aftercare expectations and resolve concerns fairly with clear records." },
  { category: "Business", lessons: 5, minutes: 30, title: "Building repeat beauty bookings", description: "Use professional follow-up and rebooking habits to build lasting client relationships." }
];

if (cleanerModules.length !== 34 || beauticianModules.length !== 34) {
  throw new Error("Each Academy profession catalogue must contain 34 modules.");
}

const catalogues = {
  cleaner: {
    label: "Cleaner",
    icon: "⌂",
    modules: cleanerModules,
    featuredTitle: "COSHH — safe use of chemicals",
    featuredCopy: "Labels, dilution, storage and what to do after a spill. Course access is not connected yet."
  },
  beautician: {
    label: "Beautician",
    icon: "✦",
    modules: beauticianModules,
    featuredTitle: "Hygiene, sanitation & infection control",
    featuredCopy: "Clean tools, work areas and hands correctly before, during and after every appointment. Course access is not connected yet."
  }
};

function selectedServiceType(value) {
  return value === "beautician" ? "beautician" : "cleaner";
}

function setText(selector, copy) {
  const node = document.querySelector(selector);
  if (node) node.textContent = copy;
}

function renderModule(module, showFeedback) {
  const card = element("article", "hc-academy-card");
  card.dataset.trainingCategory = module.category.toLowerCase();

  const metadata = element("div", "hc-academy-card-meta");
  metadata.append(
    element("span", `hc-academy-tag is-${module.category.toLowerCase()}`, module.category),
    element("small", "", `${module.lessons} lessons · ${module.minutes} min`)
  );

  const actions = element("div", "hc-academy-card-actions");
  const start = element("button", "", "Start course ↗");
  start.type = "button";
  start.addEventListener("click", () => {
    showFeedback(`“${module.title}” is not available yet. Nothing was started, completed or recorded.`, "error");
    document.querySelector("[data-training-feedback]")?.focus();
  });
  actions.append(start, element("small", "", "Course preview"));
  card.append(metadata, element("h2", "", module.title), element("p", "", module.description), actions);
  return card;
}

function showCataloguePresentation(catalogue) {
  document.title = `Homle ${catalogue.label} Academy | Homle`;
  setText("[data-training-title]", `Homle ${catalogue.label} Academy`);
  setText("[data-training-intro]", `Free training catalogue tailored to your ${catalogue.label} profession. Course delivery, progress tracking and certificates are being connected; nothing is started or recorded on this preview.`);
  setText("[data-training-profession-label]", `${catalogue.label} training`);
  setText("[data-training-profession-icon]", catalogue.icon);
  setText("[data-training-feature-title]", catalogue.featuredTitle);
  setText("[data-training-feature-copy]", catalogue.featuredCopy);
  setText("[data-training-catalogue-count]", String(catalogue.modules.length));
  const grid = document.querySelector("[data-training-modules]");
  grid?.setAttribute("aria-label", `${catalogue.modules.length} ${catalogue.label} learning modules`);
}

createCleanerPage("training", async ({ showFeedback, requestJson }) => {
  const grid = document.querySelector("[data-training-modules]");
  const resultStatus = document.querySelector("[data-training-result-status]");
  const filterButtons = [...document.querySelectorAll("[data-training-filter]")];
  const business = await requestJson("/api/marketplace/cleaner/onboarding/business");
  const serviceType = selectedServiceType(business.section?.data?.serviceType);
  const catalogue = catalogues[serviceType];
  showCataloguePresentation(catalogue);

  function showModules(filter = "all") {
    const visible = filter === "all"
      ? catalogue.modules
      : catalogue.modules.filter((module) => module.category.toLowerCase() === filter);
    grid?.replaceChildren(...visible.map((module) => renderModule(module, showFeedback)));
    if (resultStatus) resultStatus.textContent = `${visible.length} ${filter === "all" ? catalogue.label : filter} learning modules shown.`;
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
    showFeedback(`${catalogue.featuredTitle} course delivery and progress tracking are not connected yet. Nothing was started or recorded.`, "error");
    document.querySelector("[data-training-feedback]")?.focus();
  });

  showModules();
});

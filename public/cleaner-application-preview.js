import { parseCleanerTravelAreas } from "./travel-coverage.js";

const serviceLabels = Object.freeze({
  serviceTurnovers: "Rental turnovers",
  serviceEndOfTenancy: "End-of-tenancy",
  serviceWorkplaces: "Offices and workplaces",
  serviceCommunal: "Communal areas",
  serviceDeepCleans: "Deep cleans"
});

const equipmentLabels = Object.freeze({
  "bring-equipment-and-products": "Can bring standard equipment and cleaning products",
  "bring-equipment-products-supplied": "Can bring equipment; cleaning products need to be supplied",
  "equipment-and-products-supplied": "Equipment and cleaning products need to be supplied",
  "confirm-per-opportunity": "Equipment and products must be agreed for each opportunity"
});

function cleanText(value, maximum = 600) {
  return typeof value === "string"
    ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maximum)
    : "";
}

function listLanguages(value) {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const languages = [];
  const seen = new Set();
  for (const item of items) {
    const language = cleanText(item, 40);
    const key = language.toLocaleLowerCase("en-GB");
    if (language && !seen.has(key) && languages.length < 10) {
      seen.add(key);
      languages.push(language);
    }
  }
  return languages;
}

function profileInitials(name) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("en-GB")).join("");
  return initials || "YOU";
}

function formattedFirstAvailability(date, start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || end <= start) return "Add one complete future window";
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "Add one complete future window";
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(parsed);
  return `${day}, ${start}–${end} · applicant supplied, unconfirmed`;
}

export function cleanerApplicationPreview(input = {}) {
  const name = cleanText(input.fullName, 120);
  const bio = cleanText(input.professionalBio, 600);
  const experience = cleanText(input.experience, 80);
  const travelAreas = cleanText(input.travelAreas, 240);
  const languages = listLanguages(input.languages);
  const equipmentCode = cleanText(input.equipmentPlan, 60);
  const services = Object.entries(serviceLabels).filter(([key]) => input[key] === true).map(([, label]) => label);
  const firstAvailableDate = cleanText(input.firstAvailableDate, 10);
  const firstAvailableStartTime = cleanText(input.firstAvailableStartTime, 5);
  const firstAvailableEndTime = cleanText(input.firstAvailableEndTime, 5);
  const hasFirstWindow = /^\d{4}-\d{2}-\d{2}$/.test(firstAvailableDate)
    && /^\d{2}:\d{2}$/.test(firstAvailableStartTime)
    && /^\d{2}:\d{2}$/.test(firstAvailableEndTime)
    && firstAvailableEndTime > firstAvailableStartTime;
  const checks = [
    [Boolean(name), "full name"],
    [services.length > 0, "at least one service"],
    [Boolean(experience), "experience"],
    [Boolean(travelAreas) && parseCleanerTravelAreas(travelAreas).valid, "matchable work areas"],
    [bio.length >= 40 && bio.length <= 600, "professional introduction"],
    [languages.length > 0, "languages"],
    [Object.hasOwn(equipmentLabels, equipmentCode), "equipment plan"],
    [hasFirstWindow, "first available window"]
  ];
  const completed = checks.filter(([ready]) => ready).length;

  return Object.freeze({
    name: name || "Your name",
    initials: profileInitials(name),
    bio: bio || "Your professional introduction will appear here.",
    services: Object.freeze(services),
    experience: experience || "Not added yet",
    languages: Object.freeze(languages),
    equipment: equipmentLabels[equipmentCode] || "Not added yet",
    travelAreas: travelAreas || "Not added yet",
    firstAvailability: formattedFirstAvailability(firstAvailableDate, firstAvailableStartTime, firstAvailableEndTime),
    completion: Object.freeze({
      completed,
      total: checks.length,
      percent: Math.round((completed / checks.length) * 100),
      missing: Object.freeze(checks.filter(([ready]) => !ready).map(([, label]) => label))
    })
  });
}

export { equipmentLabels, serviceLabels };

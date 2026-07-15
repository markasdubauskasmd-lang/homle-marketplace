const equipmentPlans = Object.freeze({
  "bring-equipment-and-products": "Can bring standard equipment and cleaning products",
  "bring-equipment-products-supplied": "Can bring equipment; cleaning products need to be supplied",
  "equipment-and-products-supplied": "Equipment and cleaning products need to be supplied",
  "confirm-per-opportunity": "Equipment and products must be agreed for each opportunity"
});

function requiredText(value, minimum, maximum, label) {
  const normalized = typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "") : "";
  if (normalized.length < minimum || normalized.length > maximum) throw new TypeError(`${label} must contain ${minimum} to ${maximum} characters.`);
  return normalized;
}

function languageList(value) {
  const raw = (Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []).filter((item) => typeof item === "string" && item.trim());
  if (raw.length > 10) throw new TypeError("List no more than 10 languages.");
  const languages = [];
  const seen = new Set();
  for (const item of raw) {
    const language = requiredText(item, 1, 40, "Each language");
    const key = language.toLocaleLowerCase("en-GB");
    if (!seen.has(key)) {
      seen.add(key);
      languages.push(language);
    }
  }
  if (!languages.length) throw new TypeError("List at least one language you can use with customers.");
  return languages;
}

export function normalizeCleanerProfileStarter(input = {}) {
  const errors = [];
  let professionalBio = "";
  let languages = [];
  let equipmentPlan = "";
  try { professionalBio = requiredText(input.professionalBio, 40, 600, "Professional introduction"); } catch (error) { errors.push(error.message); }
  try { languages = languageList(input.languages); } catch (error) { errors.push(error.message); }
  try {
    equipmentPlan = requiredText(input.equipmentPlan, 1, 60, "Equipment and products plan");
    if (!Object.hasOwn(equipmentPlans, equipmentPlan)) throw new TypeError("Choose a supported equipment and products plan.");
  } catch (error) {
    errors.push(error.message);
  }
  if (errors.length) throw new TypeError(errors.join(" "));
  return { professionalBio, languages, equipmentPlan };
}

export function normalizeOptionalCleanerProfileStarter(input = {}) {
  const supplied = [input.professionalBio, input.languages, input.equipmentPlan].some((value) => Array.isArray(value) ? value.some((item) => String(item || "").trim()) : String(value || "").trim());
  if (!supplied) return { professionalBio: "", languages: [], equipmentPlan: "" };
  return normalizeCleanerProfileStarter(input);
}

export function cleanerProfileStarterCaptured(record = {}) {
  try {
    normalizeCleanerProfileStarter(record);
    return true;
  } catch {
    return false;
  }
}

export function cleanerEquipmentPlanLabel(code) {
  return equipmentPlans[code] || "Equipment and products plan not supplied";
}

export { equipmentPlans };

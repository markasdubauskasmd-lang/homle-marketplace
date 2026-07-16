export const cleanerServiceDefinitions = Object.freeze([
  Object.freeze({ code: "regular-domestic", label: "Regular domestic" }),
  Object.freeze({ code: "rental-turnovers", label: "Rental turnover" }),
  Object.freeze({ code: "end-of-tenancy", label: "End of tenancy" }),
  Object.freeze({ code: "workplaces", label: "Workplace" }),
  Object.freeze({ code: "communal-areas", label: "Communal areas" }),
  Object.freeze({ code: "deep-cleans", label: "Deep clean" })
]);

const outwardPostcodePattern = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;

export function commaList(value, maximumItems = 30, maximumLength = 100, label = "Entry") {
  const source = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  const result = [...new Set(source)];
  if (result.length > maximumItems) throw new TypeError(`${label} has too many entries.`);
  if (result.some((item) => item.length > maximumLength)) throw new TypeError(`${label} entries must be ${maximumLength} characters or fewer.`);
  return result;
}

export function moneyToPence(value, label, required = false) {
  const supplied = String(value ?? "").trim();
  if (!supplied) {
    if (required) throw new TypeError(`${label} is required.`);
    return null;
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(supplied)) throw new TypeError(`${label} must use pounds and no more than two decimal places.`);
  const pence = Math.round(Number(supplied) * 100);
  if (!Number.isSafeInteger(pence) || pence < 1 || pence > 1_000_000) throw new TypeError(`${label} must be between £0.01 and £10,000.`);
  return pence;
}

export function penceToMoney(value) {
  return Number.isInteger(value) && value > 0 ? (value / 100).toFixed(2) : "";
}

export function fixedPriceOptionsFromText(value) {
  const lines = String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 12) throw new TypeError("Add no more than 12 fixed-price options.");
  return lines.map((line, index) => {
    const separator = line.lastIndexOf(":");
    if (separator < 1) throw new TypeError(`Fixed price line ${index + 1} must use “Service name: 75.00”.`);
    const label = line.slice(0, separator).trim();
    if (!label || label.length > 80) throw new TypeError(`Fixed price line ${index + 1} needs a label of 80 characters or fewer.`);
    return { label, pricePence: moneyToPence(line.slice(separator + 1), `Fixed price line ${index + 1}`, true) };
  });
}

export function fixedPriceOptionsToText(options) {
  return (Array.isArray(options) ? options : []).filter((item) => item?.label && Number.isInteger(item.pricePence)).map((item) => `${item.label}: ${penceToMoney(item.pricePence)}`).join("\n");
}

export function outwardPostcodes(value) {
  const supplied = String(value || "").split(",").map((code) => code.trim().toUpperCase().replace(/\s/g, "")).filter(Boolean);
  const codes = [...new Set(supplied)];
  if (codes.length > 50) throw new TypeError("Add no more than 50 service areas.");
  if (codes.some((code) => !outwardPostcodePattern.test(code))) throw new TypeError("Service areas must use UK outward postcodes such as SW2 or EC1A.");
  return codes;
}

export function preservedServiceAreas(codes, existingAreas = []) {
  const existing = new Map((Array.isArray(existingAreas) ? existingAreas : []).map((area) => [String(area?.outwardPostcode || "").toUpperCase(), area]));
  return codes.map((outwardPostcode) => {
    const previous = existing.get(outwardPostcode);
    const latitude = previous?.latitude == null ? null : Number(previous.latitude);
    const longitude = previous?.longitude == null ? null : Number(previous.longitude);
    return { outwardPostcode, latitude: Number.isFinite(latitude) ? latitude : null, longitude: Number.isFinite(longitude) ? longitude : null };
  });
}

export function profileCompletionDetails(profile) {
  const groups = [
    {
      key: "introduction",
      label: "Introduction",
      checks: [
        [String(profile.biography || "").trim().length >= 40, "biography"],
        [profile.yearsExperience != null, "experience"],
        [Array.isArray(profile.languages) && profile.languages.length > 0, "languages"],
        [profile.residentialPreference === true || profile.commercialPreference === true, "work preference"]
      ]
    },
    {
      key: "services",
      label: "Services and prices",
      checks: [
        [Array.isArray(profile.services) && profile.services.length > 0, "service"],
        [profile.hourlyRatePence != null || (Array.isArray(profile.fixedPriceOptions) && profile.fixedPriceOptions.length > 0) || profile.services?.some((service) => service.pricePence != null), "price"]
      ]
    },
    {
      key: "boundaries",
      label: "Area and supplies",
      checks: [
        [profile.travelRadiusKm != null, "travel radius"],
        [Array.isArray(profile.serviceAreas) && profile.serviceAreas.length > 0, "service area"],
        [(profile.equipmentSupplied?.length || 0) + (profile.productsSupplied?.length || 0) > 0, "equipment or products"]
      ]
    }
  ];
  const sections = groups.map((group) => {
    const missing = group.checks.filter(([complete]) => !complete).map(([, label]) => label);
    return Object.freeze({ key: group.key, label: group.label, completed: group.checks.length - missing.length, total: group.checks.length, complete: missing.length === 0, missing: Object.freeze(missing) });
  });
  const completed = sections.reduce((total, section) => total + section.completed, 0);
  const total = sections.reduce((sum, section) => sum + section.total, 0);
  return Object.freeze({ percent: Math.round((completed / total) * 100), completed, total, sections: Object.freeze(sections) });
}

export function profileCompletion(profile) {
  return profileCompletionDetails(profile).percent;
}

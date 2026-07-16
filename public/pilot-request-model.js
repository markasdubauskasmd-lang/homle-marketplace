const propertyServiceSuggestions = Object.freeze({
  "Flat or house": "Regular home clean",
  "Office or workplace": "Regular workplace clean",
  "Communal area": "Communal area clean",
  "Short-let property": "Rental turnover clean",
  "Other commercial space": "Regular workplace clean"
});

export function suggestedPilotService(propertyType) {
  return propertyServiceSuggestions[String(propertyType || "")] || "";
}

export function pilotServiceSuggestionState({ propertyType = "", currentService = "", customerSelected = false } = {}) {
  if (customerSelected) return { service: String(currentService || ""), suggested: false };
  const service = suggestedPilotService(propertyType);
  return { service, suggested: Boolean(service) };
}

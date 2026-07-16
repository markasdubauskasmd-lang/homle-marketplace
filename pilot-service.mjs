export const cleanerServiceFields = Object.freeze({
  serviceDomestic: "Regular domestic cleaning",
  serviceTurnovers: "Rental turnovers",
  serviceEndOfTenancy: "End-of-tenancy",
  serviceWorkplaces: "Offices and workplaces",
  serviceCommunal: "Communal areas",
  serviceDeepCleans: "Deep cleans"
});

export const requestServiceMap = Object.freeze({
  "Regular home clean": "Regular domestic cleaning",
  "Rental turnover clean": "Rental turnovers",
  "End-of-tenancy clean": "End-of-tenancy",
  "Regular workplace clean": "Offices and workplaces",
  "Communal area clean": "Communal areas",
  "One-off deep clean": "Deep cleans"
});

export const requestServices = Object.freeze(Object.keys(requestServiceMap));

export function requiredCleanerService(requestedService) {
  return Object.hasOwn(requestServiceMap, requestedService) ? requestServiceMap[requestedService] : null;
}

export function cleanerOffersRequestedService(cleanerServices, requestedService) {
  const requiredService = requiredCleanerService(requestedService);
  return Boolean(requiredService && Array.isArray(cleanerServices) && cleanerServices.includes(requiredService));
}

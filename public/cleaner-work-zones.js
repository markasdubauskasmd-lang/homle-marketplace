export const ukWorkZones = Object.freeze([
  Object.freeze({ code: "scotland", name: "Scotland", shortLabel: "Scotland", path: "M190 40L270 22L332 55L316 104L344 138L310 184L240 194L202 160L172 98Z", labelX: 258, labelY: 112 }),
  Object.freeze({ code: "northern-ireland", name: "Northern Ireland", shortLabel: "N. Ireland", path: "M58 218L126 203L158 233L143 286L84 292L54 256Z", labelX: 106, labelY: 251 }),
  Object.freeze({ code: "north-west", name: "North West England", shortLabel: "North West", path: "M210 190L269 184L280 254L223 274L194 232Z", labelX: 236, labelY: 228 }),
  Object.freeze({ code: "north-east", name: "North East England", shortLabel: "North East", path: "M269 184L319 174L354 235L316 272L280 254Z", labelX: 312, labelY: 224 }),
  Object.freeze({ code: "yorkshire-humber", name: "Yorkshire and the Humber", shortLabel: "Yorkshire", path: "M223 274L316 272L337 325L261 338L218 306Z", labelX: 278, labelY: 305 }),
  Object.freeze({ code: "wales", name: "Wales", shortLabel: "Wales", path: "M158 300L220 292L252 345L226 412L169 397L143 350Z", labelX: 194, labelY: 353 }),
  Object.freeze({ code: "west-midlands", name: "West Midlands", shortLabel: "W. Midlands", path: "M220 292L261 338L287 395L230 407L208 354Z", labelX: 250, labelY: 370 }),
  Object.freeze({ code: "east-midlands", name: "East Midlands", shortLabel: "E. Midlands", path: "M261 338L337 325L362 390L288 401Z", labelX: 315, labelY: 369 }),
  Object.freeze({ code: "east-england", name: "East of England", shortLabel: "East", path: "M337 325L382 339L407 391L390 456L346 431L288 401L362 390Z", labelX: 368, labelY: 392 }),
  Object.freeze({ code: "south-west", name: "South West England", shortLabel: "South West", path: "M169 397L230 407L282 446L246 487L190 502L136 542L94 526L124 484Z", labelX: 188, labelY: 464 }),
  Object.freeze({ code: "south-east", name: "South East England", shortLabel: "South East", path: "M230 407L288 401L346 431L390 456L370 516L300 528L246 487L282 446Z", labelX: 309, labelY: 482 }),
  Object.freeze({ code: "london", name: "London", shortLabel: "London", path: "M317 432A20 20 0 1 1 357 432A20 20 0 1 1 317 432Z", labelX: 337, labelY: 436 })
]);

const zoneCodes = new Set(ukWorkZones.map((zone) => zone.code));

export function normalizedWorkZones(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim().toLowerCase()).filter((code) => zoneCodes.has(code)))];
}

export function toggledWorkZones(value, code) {
  const zones = normalizedWorkZones(value);
  if (!zoneCodes.has(code)) return zones;
  return zones.includes(code) ? zones.filter((candidate) => candidate !== code) : [...zones, code];
}

export function workZoneName(code) {
  return ukWorkZones.find((zone) => zone.code === code)?.name || "UK work zone";
}

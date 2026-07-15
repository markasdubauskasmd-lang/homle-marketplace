function cleanText(value, max = 240) {
  return typeof value === "string" ? value.trim().toUpperCase().slice(0, max) : "";
}

export function parseCleanerTravelAreas(value) {
  const declaration = cleanText(value);
  const outwardCodes = [...new Set([...declaration.matchAll(/(^|[^A-Z0-9])([A-Z]{1,2}\d[A-Z\d]?)(?=$|[^A-Z0-9])/g)].map((match) => match[2]))];
  const areaCodes = [...new Set(declaration
    .split(/[,;\n/]+/)
    .map((part) => part.trim())
    .filter((part) => /^[A-Z]{1,2}$/.test(part)))];
  return { declaration, outwardCodes, areaCodes, valid: outwardCodes.length > 0 || areaCodes.length > 0 };
}

export function cleanerTravelCoverage(travelAreas, postcode) {
  const declaration = parseCleanerTravelAreas(travelAreas);
  const compactPostcode = cleanText(postcode, 20).replace(/\s+/g, "");
  const outwardCode = compactPostcode.length > 3 ? compactPostcode.slice(0, -3) : "";
  const postcodeArea = outwardCode.match(/^[A-Z]+/)?.[0] || "";
  const exact = Boolean(outwardCode && declaration.outwardCodes.includes(outwardCode));
  const area = Boolean(postcodeArea && declaration.areaCodes.includes(postcodeArea));
  return { ...declaration, outwardCode, postcodeArea, exact, area, covered: exact || area };
}

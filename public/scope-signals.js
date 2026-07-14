const rules = [
  { code: "oven-interior", label: "Inside oven cleaning", pattern: /\b(?:clean(?:ing)?\s+(?:inside\s+)?(?:the\s+)?oven|inside\s+(?:the\s+)?oven|oven\s+interior)\b/i },
  { code: "fridge-freezer-interior", label: "Inside fridge or freezer cleaning", pattern: /\b(?:clean(?:ing)?\s+(?:inside\s+)?(?:the\s+)?(?:fridge|freezer)|inside\s+(?:the\s+)?(?:fridge|freezer)|(?:fridge|freezer)\s+interior)\b/i },
  { code: "inside-storage", label: "Inside cupboards, cabinets, drawers or wardrobes", pattern: /\b(?:(?:inside|interiors?)\s+(?:of\s+)?(?:the\s+)?(?:cupboards?|cabinets?|drawers?|wardrobes?)|(?:cupboard|cabinet|drawer|wardrobe)\s+interiors?)\b/i },
  { code: "window-cleaning", label: "Window cleaning", pattern: /\b(?:(?:clean|wash|wipe|polish)(?:ing)?\s+(?:the\s+)?(?:(?:inside|outside|external|interior)\s+)?windows?|window\s+cleaning)\b/i },
  { code: "linen-laundry", label: "Laundry, linen or bed change", pattern: /\b(?:laundry|linen\s+change|change\s+(?:the\s+)?(?:bed|beds|bedding|linen)|make\s+(?:the\s+)?beds?|wash\s+(?:the\s+)?(?:linen|bedding|sheets|towels))\b/i },
  { code: "carpet-upholstery", label: "Carpet, rug, upholstery or mattress cleaning", pattern: /\b(?:(?:carpet|rug|sofa|upholstery|mattress)s?\s+(?:clean|cleaning|wash|washing|shampoo|shampooing|steam)|(?:steam|shampoo)\s+(?:clean(?:ing)?\s+)?(?:the\s+)?(?:carpets?|rugs?|sofa|upholstery|mattress))\b/i },
  { code: "waste-removal", label: "Rubbish, waste, junk or furniture removal", pattern: /\b(?:(?:rubbish|waste|junk|furniture)\s+(?:removal|clearance)|(?:remove|clear|dispose\s+of)\s+(?:the\s+)?(?:rubbish|waste|junk|furniture))\b/i },
  { code: "outdoor-area", label: "Balcony, patio or terrace cleaning", pattern: /\b(?:balcony|patio|terrace)\s+(?:clean|cleaning|sweep|sweeping|wash|washing)\b/i },
  { code: "walls-ceilings", label: "Wall or ceiling washing and mark removal", pattern: /\b(?:(?:(?:wash|clean|wipe)(?:ing)?|remove\s+marks?\s+from)\s+(?:the\s+)?(?:walls?|ceilings?)|(?:wall|ceiling)\s+(?:washing|cleaning|mark\s+removal))\b/i }
];

const ruleByCode = new Map(rules.map((rule) => [rule.code, rule]));

export function detectPriceSensitiveScope({ transcript = "", checklist = [], photos = [] } = {}) {
  const source = [transcript, ...(Array.isArray(checklist) ? checklist : []), ...(Array.isArray(photos) ? photos.map((photo) => photo?.note || "") : [])].join("\n");
  return rules.filter((rule) => rule.pattern.test(source)).map(({ code, label }) => ({ code, label }));
}

export function normalisePriceSensitiveScopeSignals(signals = []) {
  const codes = new Set((Array.isArray(signals) ? signals : []).map((signal) => String(signal?.code || "").trim()).filter((code) => ruleByCode.has(code)));
  return [...codes].map((code) => ({ code, label: ruleByCode.get(code).label }));
}

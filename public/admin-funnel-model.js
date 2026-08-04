const windows = new Set([7, 30, 90]);

export function funnelWindow(value) {
  const selected = Number(value);
  if (!Number.isInteger(selected) || !windows.has(selected)) throw new TypeError("Choose a 7, 30 or 90 day window.");
  return selected;
}

export function stagePercent(value, cohort) {
  if (!Number.isInteger(value) || value < 0 || !Number.isInteger(cohort) || cohort < 0 || value > cohort) throw new TypeError("Funnel totals are unavailable.");
  return cohort === 0 ? null : Math.round((value / cohort) * 100);
}

export function percentLabel(value, cohort) {
  const percent = stagePercent(value, cohort);
  return percent == null ? "No matured cohort yet" : `${percent}% of cohort`;
}

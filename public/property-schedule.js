// Customer scheduling uses the property's UK calendar, never the browser zone.
export const propertyTimeZone = "Europe/London";
const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: propertyTimeZone, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

export function propertyDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Choose a valid cleaning date and start time.");
  const parts = Object.fromEntries(partsFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function propertyStartAt(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) || !/^\d{2}:\d{2}$/.test(String(time || ""))) {
    throw new TypeError("Choose a valid cleaning date and start time.");
  }
  const wall = Date.parse(`${date}T${time}:00Z`);
  // Reject normalized dates such as 31 February and 24:00 before resolving DST.
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== `${date}T${time}`) {
    throw new TypeError("Choose a valid cleaning date and start time.");
  }
  // Sample the timezone on both sides of a possible clock change. Derive offsets
  // from Intl instead of assuming the browser's offset or hardcoding BST dates.
  const offsets = new Set([-24, 0, 24].map((hours) => {
    const instant = wall + hours * 3_600_000;
    const local = propertyDateTime(instant);
    return Date.parse(`${local.date}T${local.time}:00Z`) - instant;
  }));
  const candidates = [...offsets].map((offset) => wall - offset).filter((instant) => {
    const local = propertyDateTime(instant);
    return local.date === date && local.time === time;
  });
  if (!candidates.length) throw new TypeError("This UK time does not exist because the clocks move forward. Choose another start time.");
  if (candidates.length > 1) throw new TypeError("This UK time occurs twice because the clocks move back. Choose a start time outside the repeated hour.");
  return new Date(candidates[0]).toISOString();
}

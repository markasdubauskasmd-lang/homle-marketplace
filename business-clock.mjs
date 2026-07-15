export const businessTimeZone = "Europe/London";

const londonClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: businessTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

function clockParts(now) {
  const value = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(value.getTime())) throw new TypeError("A valid time is required.");
  return Object.fromEntries(londonClock.formatToParts(value).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

export function businessDateToday(now = Date.now()) {
  const parts = clockParts(now);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

// Visit dates and times are stored as London wall-clock values. Representing
// today's London clock on the same UTC-shaped scale lets those values be
// compared safely without treating British Summer Time as real UTC.
export function businessWallClockMs(now = Date.now()) {
  const parts = clockParts(now);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

export function earliestBookableWallClockMs(now = Date.now(), leadMinutes = 15, intervalMinutes = 15) {
  const intervalMs = intervalMinutes * 60 * 1000;
  return Math.ceil((businessWallClockMs(now) + leadMinutes * 60 * 1000) / intervalMs) * intervalMs;
}

export function businessEpochFromWallClock(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) return NaN;
  const [year, month, day] = String(date).split("-").map(Number);
  const [hour, minute] = String(time).split(":").map(Number);
  const targetWallClockMs = Date.UTC(year, month - 1, day, hour, minute);
  const parsed = new Date(targetWallClockMs);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return NaN;
  let instantMs = targetWallClockMs;
  for (let attempt = 0; attempt < 3; attempt += 1) instantMs += targetWallClockMs - businessWallClockMs(instantMs);
  return businessWallClockMs(instantMs) === targetWallClockMs ? instantMs : NaN;
}

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// P1-6 / DECISIONS D27: the Cleaner workspace uses the Landlord workspace's
// design system. These guard the two mechanisms that make that true.
const publicDirectory = new URL("../public/", import.meta.url);
const pages = readdirSync(publicDirectory).filter((name) => name.endsWith(".html"))
  .filter((name) => readFileSync(new URL(name, publicDirectory), "utf8").includes("/homle-cleaner.css"));
assert(pages.length >= 18, `Only ${pages.length} Cleaner pages were found; the page set has changed and this guard needs to follow it.`);
for (const page of pages) {
  const html = readFileSync(new URL(page, publicDirectory), "utf8");
  const head = html.slice(0, html.indexOf("</head>"));
  const sheets = [...head.matchAll(/<link rel="stylesheet" href="([^"?]+)/g)].map((match) => match[1]);
  assert.equal(sheets.at(-1), "/cleaner-workspace-v2.css", `${page} does not load the converged design last, so its own sheets win.`);
  assert(sheets.includes("/homle-tokens.css"), `${page} does not load the shared tokens, so DM Sans never arrives.`);
}

// No warm cream or brown may come back into the Cleaner sheet: each was
// replaced by the neutral grey of the same luminance. Reds, greens and ambers
// are untouched and not matched here.
function warmCream(hex) {
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), lightness = (max + min) / 2;
  if (max === min) return false;
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  if (saturation < 0.04 || hue < 15 || hue > 65) return false;
  if (lightness >= 0.96) return true;
  return lightness > 0.35 ? saturation <= (lightness >= 0.8 ? 0.6 : 0.45) : saturation <= 0.45;
}
const cleanerSheet = readFileSync(new URL("homle-cleaner.css", publicDirectory), "utf8");
const warm = [...new Set([...cleanerSheet.matchAll(/#([0-9a-fA-F]{6})\b/g)].map((match) => match[1].toLowerCase()))].filter(warmCream);
assert.deepEqual(warm, [], `homle-cleaner.css has warm cream/brown values again: ${warm.map((value) => `#${value}`).join(", ")}. Use the Landlord neutrals.`);

console.log(`Cleaner design convergence passed: ${pages.length} Cleaner pages load the Landlord system last with its tokens, and no warm cream has returned.`);

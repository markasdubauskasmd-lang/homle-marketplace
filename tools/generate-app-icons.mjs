#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(projectRoot, "public");
const logoPath = path.join(publicRoot, "logo.svg");

await Promise.all([
  sharp(logoPath).resize(192, 192).png().toFile(path.join(publicRoot, "app-icon-192.png")),
  sharp(logoPath).resize(512, 512).png().toFile(path.join(publicRoot, "app-icon-512.png")),
  sharp(logoPath).resize(180, 180).png().toFile(path.join(publicRoot, "apple-touch-icon.png"))
]);

const maskableLogo = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <defs>
      <radialGradient id="red" cx="48%" cy="36%" r="72%">
        <stop offset="0" stop-color="#f20a16"/>
        <stop offset="0.62" stop-color="#df0712"/>
        <stop offset="1" stop-color="#ba000b"/>
      </radialGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="1.4" stdDeviation="1.25" flood-color="#690006" flood-opacity="0.55"/>
      </filter>
    </defs>
    <rect width="512" height="512" fill="url(#red)"/>
    <g transform="translate(256 256) scale(5) translate(-32 -32)">
      <g fill="#ffffff" filter="url(#shadow)">
        <path d="M28.7 21.8 17.3 30.7C16.5 31.4 16 32.6 16 33.8v15.5c0 3.4 2.5 5.7 5.8 5.7h6.5c.7 0 1.2-.5 1.2-1.2V43c0-3.2 1.8-5.1 5-5.1h.7c3.3 0 5.1-2.1 5.2-5.3H37c-2.5 0-3.9-1.4-3.9-3.8v-5.2c0-2.4-2.4-3.4-4.4-1.8Z"/>
        <path d="M35.5 23.5v6.2c0 3.1 1.7 5.1 4.8 5.1h.4c-.5 3-2.3 4.6-5.2 5.1-2.1.4-3.1 1.9-3.1 4.2v9.6c0 .8.6 1.3 1.3 1.3h8.5c3.3 0 5.8-2.4 5.8-5.7V33.6c0-1.3-.5-2.4-1.4-3.1l-8.5-7c-1-.8-2.6-.7-2.6 0Z"/>
      </g>
      <path d="M11.8 31 32 12.2 52.2 31" fill="none" stroke="#ffffff" stroke-width="6.4" stroke-linecap="round" stroke-linejoin="round" filter="url(#shadow)"/>
    </g>
  </svg>
`);
await sharp(maskableLogo).png().toFile(path.join(publicRoot, "app-icon-maskable-512.png"));

console.log("Homle app icons generated from the curved split-home logo.");

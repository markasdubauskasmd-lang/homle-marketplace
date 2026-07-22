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
    <rect width="512" height="512" fill="#d7182a"/>
    <g transform="translate(256 256) scale(5) translate(-32 -32)">
      <path d="M11 32.5 L32 13 L53 32.5" fill="none" stroke="#ffffff" stroke-width="6.4" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="14.6" y="31" width="15" height="21" rx="3.2" fill="#ffffff"/>
      <rect x="32.4" y="28" width="15" height="24" rx="3.2" fill="#ffffff"/>
    </g>
  </svg>
`);
await sharp(maskableLogo).png().toFile(path.join(publicRoot, "app-icon-maskable-512.png"));

console.log("Homle app icons generated from the reviewed logo.");

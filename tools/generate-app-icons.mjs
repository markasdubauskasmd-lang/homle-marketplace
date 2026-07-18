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
    <g transform="translate(64 64) scale(6)">
      <rect x="15" y="27" width="34" height="30" rx="11" fill="#ffffff"/>
      <path d="M32 6 L44 18 L32 30 L20 18 Z" fill="none" stroke="#141114" stroke-width="5.4" stroke-linejoin="round"/>
      <circle cx="32" cy="42" r="6.4" fill="none" stroke="#d7182a" stroke-width="3.2"/>
      <circle cx="32" cy="42" r="2.5" fill="#d7182a"/>
    </g>
  </svg>
`);
await sharp(maskableLogo).png().toFile(path.join(publicRoot, "app-icon-maskable-512.png"));

console.log("Homle app icons generated from the reviewed logo.");

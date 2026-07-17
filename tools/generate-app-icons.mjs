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
    <rect width="512" height="512" fill="#0e665b"/>
    <path d="M160 136h62v92h68v-92h62v240h-62v-92h-68v92h-62z" fill="#fff"/>
    <path d="M128 404c43-35 85 35 128 0s85 35 128 0" fill="none" stroke="#8ee3d2" stroke-width="22" stroke-linecap="round"/>
  </svg>
`);
await sharp(maskableLogo).png().toFile(path.join(publicRoot, "app-icon-maskable-512.png"));

console.log("Homle app icons generated from the reviewed logo.");

#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(projectRoot, "public");
const logoPath = path.join(publicRoot, "homle-logo.png");

await Promise.all([
  sharp(logoPath).resize(192, 192).png().toFile(path.join(publicRoot, "app-icon-192.png")),
  sharp(logoPath).resize(512, 512).png().toFile(path.join(publicRoot, "app-icon-512.png")),
  sharp(logoPath).resize(180, 180).png().toFile(path.join(publicRoot, "apple-touch-icon.png"))
]);

await sharp(logoPath).resize(512, 512).png().toFile(path.join(publicRoot, "app-icon-maskable-512.png"));

console.log("Homle app icons generated from the approved exact logo artwork.");

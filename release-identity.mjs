import { readFile } from "node:fs/promises";
import path from "node:path";

export const releaseIdentityFilename = "homle-release.json";

function exactIsoTimestamp(value) {
  if (typeof value !== "string" || value.length < 20 || value.length > 35) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : null;
}

export function normalizePackagedReleaseIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Packaged release identity must be an object.");
  if (value.schemaVersion !== 1 || value.application !== "Homle") throw new TypeError("Packaged release identity has an unsupported application or schema.");
  const sourceCommit = String(value.sourceCommit || "").trim().toLowerCase();
  const builtAt = exactIsoTimestamp(value.builtAt);
  const migrationCount = Number(value.migrationCount);
  if (!/^[0-9a-f]{8}$/.test(sourceCommit) || !builtAt || !Number.isInteger(migrationCount) || migrationCount < 1 || migrationCount > 10_000) {
    throw new TypeError("Packaged release identity contains invalid build evidence.");
  }
  return Object.freeze({ source: "packaged", sourceCommit, builtAt, migrationCount });
}

export async function loadReleaseIdentity({ projectRoot, readFileImplementation = readFile } = {}) {
  const root = path.resolve(String(projectRoot || ""));
  if (!projectRoot || typeof readFileImplementation !== "function") throw new TypeError("A project root and file reader are required.");
  try {
    const text = await readFileImplementation(path.join(root, releaseIdentityFilename), "utf8");
    if (Buffer.byteLength(text, "utf8") > 4096) throw new TypeError("Packaged release identity exceeds the size limit.");
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new TypeError("Packaged release identity is not valid JSON."); }
    return normalizePackagedReleaseIdentity(parsed);
  } catch (error) {
    if (error?.code === "ENOENT") return Object.freeze({ source: "unidentified", sourceCommit: null, builtAt: null, migrationCount: null });
    throw error;
  }
}

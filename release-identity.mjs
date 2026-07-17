import { readFile } from "node:fs/promises";
import path from "node:path";

export const releaseIdentityFilename = "homle-release.json";

export function normalizeExpectedReleaseCommit(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(normalized)) throw new TypeError("Expected release must be the exact eight-character source commit from the verified package manifest.");
  return normalized;
}

function exactIsoTimestamp(value) {
  if (typeof value !== "string" || value.length < 20 || value.length > 35) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : null;
}

export function normalizePackagedReleaseIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Packaged release identity must be an object.");
  if (value.schemaVersion !== 1 || value.application !== "Homle") throw new TypeError("Packaged release identity has an unsupported application or schema.");
  let sourceCommit;
  try { sourceCommit = normalizeExpectedReleaseCommit(value.sourceCommit); } catch { throw new TypeError("Packaged release identity contains invalid build evidence."); }
  const builtAt = exactIsoTimestamp(value.builtAt);
  const migrationCount = Number(value.migrationCount);
  if (!builtAt || !Number.isInteger(migrationCount) || migrationCount < 1 || migrationCount > 10_000) {
    throw new TypeError("Packaged release identity contains invalid build evidence.");
  }
  return Object.freeze({ source: "packaged", sourceCommit, builtAt, migrationCount });
}

export function packagedReleaseIdentityMatches(value, expectedCommit = null, { now = Date.now() } = {}) {
  let expected = null;
  try { expected = expectedCommit ? normalizeExpectedReleaseCommit(expectedCommit) : null; } catch { return false; }
  if (!value || value.source !== "packaged" || !/^[0-9a-f]{8}$/.test(value.sourceCommit || "") || !Number.isInteger(value.migrationCount) || value.migrationCount < 1 || value.migrationCount > 10_000) return false;
  const builtAt = new Date(value.builtAt || "");
  if (!Number.isFinite(builtAt.getTime()) || builtAt.toISOString() !== value.builtAt || builtAt.getTime() > Number(now) + 300_000) return false;
  return !expected || value.sourceCommit === expected;
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

#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { verifyDatabaseAssets } from "../db/migration-assets.mjs";
import { normalizePackagedReleaseIdentity, releaseIdentityFilename } from "../release-identity.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseEntryPoints = Object.freeze([
  "server.mjs",
  "scripts/marketplace-worker.mjs",
  "tools/check-dependency-lock.mjs",
  "tools/domain-readiness.mjs",
  "tools/production-preflight.mjs",
  "tools/authentication-preflight.mjs",
  "tools/bootstrap-staging-database.mjs",
  "tools/staging-service-probe.mjs",
  "tools/staging-evidence-runner.mjs",
  "tools/build-hostinger-release.mjs"
]);
const alwaysIncluded = Object.freeze(["package.json", "pnpm-lock.yaml"]);
const databaseRuntimeFiles = new Set([
  "db/migration-lock.json",
  "db/migration-assets.mjs",
  "db/runtime-role-grants.sql",
  "db/worker-role-grants.sql",
  "db/bootstrap/assert-empty-staging.sql",
  "db/integration/deployment-verification.sql"
]);
const excludedRuntimeFiles = new Set([
  "public/tracking-test.html",
  "public/tracking-test.js"
]);
const forbiddenEntryPatterns = Object.freeze([
  { pattern: /(?:^|\/)\.env(?:\.|$)/i, label: "environment-secret file" },
  { pattern: /(?:^|\/)data(?:\/|$)/i, label: "private data directory" },
  { pattern: /(?:^|\/)tests?(?:\/|$)/i, label: "test source" },
  { pattern: /(?:^|\/)docs?(?:\/|$)/i, label: "internal documentation" },
  { pattern: /(?:^|\/)\.git(?:\/|$)/i, label: "Git metadata" },
  { pattern: /(?:^|\/)NEXT_STEPS(?:\.|$)/i, label: "internal launch plan" },
  { pattern: /(?:^|\/)RECOVERY(?:\.|$)/i, label: "internal recovery notes" },
  { pattern: /^public\/tracking-test\.(?:html|js)$/i, label: "local tracking laboratory" }
]);

function normalizedRelativePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function runGit(root, args, { encoding = "utf8" } = {}) {
  const git = process.env.GIT_BINARY || "git";
  const result = spawnSync(git, ["-c", `safe.directory=${root.replaceAll("\\", "/")}`, ...args], {
    cwd: root,
    encoding,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true
  });
  if (result.error) throw new Error(`Git could not run: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "unknown Git error").trim();
    throw new Error(`Git ${args[0]} failed: ${detail}`);
  }
  return result.stdout;
}

function localModuleSpecifiers(source) {
  const values = [];
  const patterns = [
    /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g,
    /import\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) values.push(match[1]);
  }
  return [...new Set(values)];
}

function resolveLocalModule(importer, specifier, trackedFiles) {
  const fileSpecifier = specifier.split(/[?#]/, 1)[0];
  const base = normalizedRelativePath(path.posix.normalize(path.posix.join(path.posix.dirname(importer), fileSpecifier)));
  const candidates = [base, `${base}.mjs`, `${base}.js`, `${base}/index.mjs`, `${base}/index.js`];
  return candidates.find((candidate) => trackedFiles.has(candidate)) || null;
}

export async function selectReleaseFiles(root = projectRoot) {
  const tracked = String(runGit(root, ["ls-files", "-z"]))
    .split("\0")
    .map(normalizedRelativePath)
    .filter(Boolean);
  const trackedFiles = new Set(tracked);
  const selected = new Set(alwaysIncluded);

  for (const file of tracked) {
    if ((file.startsWith("public/") || file.startsWith("src/")) && !excludedRuntimeFiles.has(file)) selected.add(file);
    if (file.startsWith("db/migrations/") || databaseRuntimeFiles.has(file)) selected.add(file);
  }
  for (const entry of releaseEntryPoints) selected.add(entry);

  const missingSeeds = [...selected].filter((file) => !trackedFiles.has(file));
  if (missingSeeds.length) throw new Error(`Release inputs are not committed: ${missingSeeds.join(", ")}`);

  const queue = [...selected].filter((file) => /\.(?:mjs|js)$/i.test(file));
  const inspected = new Set();
  while (queue.length) {
    const importer = queue.shift();
    if (inspected.has(importer)) continue;
    inspected.add(importer);
    const source = await readFile(path.join(root, importer), "utf8");
    for (const specifier of localModuleSpecifiers(source)) {
      const resolved = resolveLocalModule(importer, specifier, trackedFiles);
      if (!resolved) throw new Error(`Committed local import ${specifier} from ${importer} cannot be resolved.`);
      if (!selected.has(resolved)) {
        selected.add(resolved);
        if (/\.(?:mjs|js)$/i.test(resolved)) queue.push(resolved);
      }
    }
  }

  return [...selected].sort((left, right) => left.localeCompare(right, "en"));
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Release archive has no valid ZIP central directory.");
}

export function inspectZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new TypeError("Release archive is not a valid ZIP buffer.");
  const endOffset = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(endOffset + 4);
  const centralDisk = buffer.readUInt16LE(endOffset + 6);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || entryCount === 0xffff || centralOffset === 0xffffffff) {
    throw new Error("Multi-disk and ZIP64 release archives are not supported.");
  }
  if (centralOffset + centralSize > endOffset) throw new Error("Release archive central directory is out of bounds.");

  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Release archive central entry ${index + 1} is invalid.`);
    }
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > buffer.length) throw new Error(`Release archive central entry ${index + 1} is truncated.`);
    const name = normalizedRelativePath(buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    entries.push({ name, compressedSize, uncompressedSize, compressionMethod, localHeaderOffset, directory: name.endsWith("/") });
    offset = end;
  }
  if (offset !== centralOffset + centralSize) throw new Error("Release archive central directory length does not match its header.");
  return entries;
}

export function readZipEntry(buffer, entryName) {
  const selected = inspectZipEntries(buffer).find((entry) => entry.name === normalizedRelativePath(entryName));
  if (!selected || selected.directory) throw new Error(`Release archive entry was not found: ${entryName}`);
  const offset = selected.localHeaderOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error(`Release archive entry has an invalid local header: ${entryName}`);
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + selected.compressedSize;
  if (end > buffer.length) throw new Error(`Release archive entry is truncated: ${entryName}`);
  const compressed = buffer.subarray(start, end);
  const content = selected.compressionMethod === 0 ? Buffer.from(compressed) : selected.compressionMethod === 8 ? inflateRawSync(compressed) : null;
  if (!content) throw new Error(`Release archive entry uses an unsupported compression method: ${entryName}`);
  if (content.length !== selected.uncompressedSize) throw new Error(`Release archive entry size does not match: ${entryName}`);
  return content;
}

export function validateReleaseEntries(entries, expectedFiles) {
  const names = entries.map((entry) => entry.name);
  const unsafePath = names.find((name) => !name || name.startsWith("/") || /^[A-Za-z]:\//.test(name) || name.split("/").includes(".."));
  if (unsafePath) throw new Error(`Release archive contains an unsafe path: ${unsafePath}`);
  if (new Set(names).size !== names.length) throw new Error("Release archive contains duplicate paths.");

  for (const name of names) {
    for (const forbidden of forbiddenEntryPatterns) {
      if (forbidden.pattern.test(name)) throw new Error(`Release archive contains ${forbidden.label}: ${name}`);
    }
  }

  const actualFiles = names.filter((name) => !name.endsWith("/")).sort((left, right) => left.localeCompare(right, "en"));
  const expected = [...expectedFiles].sort((left, right) => left.localeCompare(right, "en"));
  const missing = expected.filter((file) => !actualFiles.includes(file));
  const unexpected = actualFiles.filter((file) => !expected.includes(file));
  if (missing.length || unexpected.length) {
    throw new Error(`Release archive allowlist mismatch. Missing: ${missing.join(", ") || "none"}. Unexpected: ${unexpected.join(", ") || "none"}.`);
  }
  for (const required of [
    "server.mjs",
    releaseIdentityFilename,
    "travel-coverage.mjs",
    "public/index.html",
    "src/marketplace/runtime.mjs",
    "db/migration-lock.json",
    "db/runtime-role-grants.sql",
    "db/worker-role-grants.sql",
    "db/bootstrap/assert-empty-staging.sql",
    "db/integration/deployment-verification.sql",
    "tools/check-dependency-lock.mjs",
    "tools/domain-readiness.mjs",
    "tools/production-preflight.mjs",
    "tools/authentication-preflight.mjs",
    "tools/bootstrap-staging-database.mjs",
    "tools/build-hostinger-release.mjs"
  ]) {
    if (!actualFiles.includes(required)) throw new Error(`Release archive omitted required runtime file ${required}.`);
  }
  return { fileCount: actualFiles.length, directoryCount: names.length - actualFiles.length };
}

function cleanCommit(value) {
  const commit = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(commit)) throw new Error("Git returned an invalid release commit identifier.");
  return commit.slice(0, 8);
}

export async function buildHostingerRelease({
  root = projectRoot,
  outputDirectory = path.resolve(root, ".."),
  requireClean = true,
  replace = false
} = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedOutput = path.resolve(outputDirectory);
  if (requireClean) {
    const status = String(runGit(resolvedRoot, ["status", "--porcelain", "--untracked-files=all"])).trim();
    if (status) throw new Error("Refusing to package a dirty worktree. Commit or remove every pending change first.");
  }
  const commit = cleanCommit(runGit(resolvedRoot, ["rev-parse", "HEAD"]));
  const databaseAssets = await verifyDatabaseAssets({ databaseDirectory: path.join(resolvedRoot, "db") });
  if (!databaseAssets.ok) throw new Error(`Refusing to package invalid database assets: ${databaseAssets.errors.join(" ")}`);
  const expectedFiles = await selectReleaseFiles(resolvedRoot);
  const expectedArchiveFiles = [...expectedFiles, releaseIdentityFilename].sort((left, right) => left.localeCompare(right, "en"));
  const archiveName = `Homle-Hostinger-Node-release-${commit}.zip`;
  const manifestName = `Homle-Hostinger-Node-release-${commit}.manifest.json`;
  const archivePath = path.join(resolvedOutput, archiveName);
  const manifestPath = path.join(resolvedOutput, manifestName);
  if (!replace && (existsSync(archivePath) || existsSync(manifestPath))) {
    throw new Error(`Release output already exists for ${commit}. Use --replace only after verifying it is safe to overwrite.`);
  }

  await mkdir(resolvedOutput, { recursive: true });
  await rm(archivePath, { force: true });
  await rm(manifestPath, { force: true });
  const temporaryDirectory = await mkdtemp(path.join(resolvedOutput, ".homle-release-build-"));
  const generatedAt = new Date().toISOString();
  const packagedIdentity = {
    schemaVersion: 1,
    application: "Homle",
    sourceCommit: commit,
    builtAt: generatedAt,
    migrationCount: databaseAssets.migrations.length
  };
  normalizePackagedReleaseIdentity(packagedIdentity);
  try {
    const identityPath = path.join(temporaryDirectory, releaseIdentityFilename);
    await writeFile(identityPath, `${JSON.stringify(packagedIdentity, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    const addedIdentityPath = normalizedRelativePath(path.relative(resolvedRoot, identityPath));
    runGit(resolvedRoot, ["archive", "--format=zip", `--output=${archivePath}`, `--add-file=${addedIdentityPath}`, "HEAD", "--", ...expectedFiles]);
    const archive = await readFile(archivePath);
    const entries = inspectZipEntries(archive);
    const counts = validateReleaseEntries(entries, expectedArchiveFiles);
    const archivedIdentity = normalizePackagedReleaseIdentity(JSON.parse(readZipEntry(archive, releaseIdentityFilename).toString("utf8")));
    if (archivedIdentity.sourceCommit !== commit || archivedIdentity.migrationCount !== databaseAssets.migrations.length || archivedIdentity.builtAt !== generatedAt) throw new Error("Release archive identity does not match the verified source and database assets.");
    const manifest = {
      schemaVersion: 1,
      application: "Homle",
      sourceCommit: commit,
      archive: archiveName,
      bytes: archive.length,
      sha256: createHash("sha256").update(archive).digest("hex").toUpperCase(),
      entryCount: entries.length,
      fileCount: counts.fileCount,
      directoryCount: counts.directoryCount,
      privateMaterialIncluded: false,
      requiredRuntimeFilesVerified: true,
      databaseAssetsVerified: true,
      migrationCount: databaseAssets.migrations.length,
      generatedAt
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return { ...manifest, archivePath, manifestPath };
  } catch (error) {
    await rm(archivePath, { force: true });
    await rm(manifestPath, { force: true });
    throw error;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function parseArguments(argv) {
  const parsed = { outputDirectory: path.resolve(projectRoot, ".."), replace: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--replace") parsed.replace = true;
    else if (value === "--output-dir") {
      const next = argv[index + 1];
      if (!next) throw new Error("--output-dir requires a directory path.");
      parsed.outputDirectory = path.resolve(next);
      index += 1;
    } else throw new Error(`Unknown release option: ${value}`);
  }
  return parsed;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const result = await buildHostingerRelease(parseArguments(process.argv.slice(2)));
    console.log(`Verified Homle Hostinger release ${result.archive}`);
    console.log(`Commit: ${result.sourceCommit}`);
    console.log(`Entries: ${result.entryCount} (${result.fileCount} files)`);
    console.log(`Bytes: ${result.bytes}`);
    console.log(`SHA-256: ${result.sha256}`);
    console.log(`Manifest: ${result.manifestPath}`);
  } catch (error) {
    console.error(`Hostinger release build failed: ${error.message}`);
    process.exitCode = 1;
  }
}

#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maximumTrackedFileBytes = 25 * 1024 * 1024;
const maximumTrackedRepositoryBytes = 100 * 1024 * 1024;
const requiredIgnoreRules = Object.freeze([".env", ".env.*", "!.env.example", "data/*.ndjson", "data/job-brief-images/", "node_modules/", "*.log", "backups/"]);
const forbiddenSecretPatterns = Object.freeze([
  { label: "private cryptographic key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "Stripe live secret", pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/ },
  { label: "GitHub access token", pattern: /\bghp_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { label: "AWS access key", pattern: /\bAKIA[A-Z0-9]{16}\b/ },
  { label: "Google API key", pattern: /\bAIza[A-Za-z0-9_-]{30,}\b/ },
  { label: "Slack access token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ }
]);

function normalizedPath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function forbiddenTrackedPath(file) {
  const normalized = normalizedPath(file);
  const lower = normalized.toLowerCase();
  const base = path.posix.basename(lower);
  if (lower === "data/.gitkeep") return "";
  if (lower.startsWith("data/")) return "private data file";
  if (lower.startsWith("backups/") || lower.startsWith("node_modules/") || lower.startsWith(".git/")) return "local-only directory";
  if (base === ".env" || (base.startsWith(".env.") && base !== ".env.example")) return "environment-secret file";
  if (/\.(?:ndjson|pem|key|p12|pfx|sqlite|sqlite3|db|zip|7z|tar|tgz|gz)$/i.test(base)) return "private, credential or archive file";
  if (/^(?:server|debug|error).*\.log$/i.test(base)) return "runtime log";
  return "";
}

function looksTextual(buffer) {
  if (!Buffer.isBuffer(buffer)) return true;
  return !buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}

export async function assessPublicationSafety({ trackedFiles, readTrackedFile, statTrackedFile, gitignore, clean = true, maximumFileBytes = maximumTrackedFileBytes, maximumRepositoryBytes = maximumTrackedRepositoryBytes }) {
  const errors = [];
  const files = [...new Set((trackedFiles || []).map(normalizedPath).filter(Boolean))].sort();
  if (!clean) errors.push("The Git worktree or index is not clean; commit or remove every change before upload.");
  if (!files.length) errors.push("No tracked files were found for publication.");
  for (const rule of requiredIgnoreRules) {
    if (!String(gitignore || "").split(/\r?\n/).includes(rule)) errors.push(`.gitignore is missing required private-material rule: ${rule}`);
  }

  let totalBytes = 0;
  for (const file of files) {
    const forbiddenReason = forbiddenTrackedPath(file);
    if (forbiddenReason) {
      errors.push(`${file} is a forbidden ${forbiddenReason}.`);
      continue;
    }
    const metadata = await statTrackedFile(file);
    const size = Number(metadata?.size);
    if (!Number.isSafeInteger(size) || size < 0) {
      errors.push(`${file} has an invalid tracked size.`);
      continue;
    }
    totalBytes += size;
    if (size > maximumFileBytes) errors.push(`${file} exceeds the ${Math.floor(maximumFileBytes / 1024 / 1024)} MiB per-file publication limit.`);
    if (size > 2 * 1024 * 1024) continue;
    const content = await readTrackedFile(file);
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ""));
    if (!looksTextual(bytes)) continue;
    const source = bytes.toString("utf8");
    for (const secret of forbiddenSecretPatterns) {
      if (secret.pattern.test(source)) errors.push(`${file} contains a possible ${secret.label}.`);
    }
  }
  if (totalBytes > maximumRepositoryBytes) errors.push(`Tracked files total more than ${Math.floor(maximumRepositoryBytes / 1024 / 1024)} MiB.`);
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), fileCount: files.length, totalBytes });
}

function runGit(argumentsList) {
  const result = spawnSync("git", ["-c", `safe.directory=${projectRoot.replaceAll("\\", "/")}`, ...argumentsList], { cwd: projectRoot, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Git publication check failed: ${String(result.stderr || result.error?.message || "unknown error").trim()}`);
  return result.stdout;
}

async function main() {
  const trackedFiles = runGit(["ls-files", "-z"]).split("\0").filter(Boolean);
  const clean = runGit(["status", "--porcelain=v1", "--untracked-files=all"]).trim() === "";
  const gitignore = await readFile(path.join(projectRoot, ".gitignore"), "utf8");
  const report = await assessPublicationSafety({
    trackedFiles,
    clean,
    gitignore,
    readTrackedFile: (file) => readFile(path.join(projectRoot, file)),
    statTrackedFile: (file) => stat(path.join(projectRoot, file))
  });
  if (!report.ok) {
    for (const error of report.errors) console.error(`Publication blocked: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Publication safety passed: ${report.fileCount} tracked files, ${(report.totalBytes / 1024 / 1024).toFixed(2)} MiB, no tracked secrets or private-data paths detected.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

#!/usr/bin/env node

import path from "node:path";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { normalizeExpectedReleaseCommit } from "../release-identity.mjs";

const toolPath = fileURLToPath(import.meta.url);
const maximumResponseBytes = 64 * 1024;
const capabilityNames = Object.freeze([
  "enabled",
  "ready",
  "authenticationReady",
  "emailReady",
  "mediaReady",
  "realtimeReady",
  "geocodingReady",
  "matchingReady",
  "paymentsReady",
  "automaticDispatchReady",
  "speechSummaryReady",
  "roomVisionReady"
]);
const coreBookingCapabilityNames = Object.freeze([
  "enabled",
  "ready",
  "authenticationReady",
  "mediaReady",
  "realtimeReady",
  "geocodingReady",
  "matchingReady",
  "automaticDispatchReady",
  "speechSummaryReady",
  "roomVisionReady"
]);

function exact(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeLiveActivationOrigin(value) {
  const supplied = exact(value).replace(/\/$/, "");
  let url;
  try { url = new URL(supplied); } catch { throw new TypeError("A valid public HTTPS origin is required."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash || url.origin !== supplied) {
    throw new TypeError("Public origin must be exact HTTPS with no credentials, port, path, query or fragment.");
  }
  const hostname = url.hostname.toLowerCase();
  if (isIP(hostname) || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || !hostname.includes(".")) {
    throw new TypeError("Public origin must use a real public hostname.");
  }
  return url.origin;
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} is missing or invalid.`);
  return value;
}

function boolean(value, label) {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be an explicit boolean.`);
  return value;
}

function action(key, copy) {
  return Object.freeze({ key, action: copy });
}

function remainingActions(snapshot) {
  const actions = [];
  if (snapshot.dataIntegrity !== "healthy" || snapshot.writesAllowed !== true) actions.push(action("data-integrity", "Repair the managed database integrity gate before any account or booking rehearsal."));
  if (!snapshot.capabilities.enabled || !snapshot.capabilities.ready) actions.push(action("marketplace-runtime", "Restore the marketplace runtime and restricted database attachment before testing private journeys."));
  if (!snapshot.capabilities.authenticationReady) actions.push(action("authentication", "Restore secure account authentication before testing either role workspace."));
  if (!snapshot.capabilities.mediaReady) actions.push(action("private-media", "Configure and verify private object storage before submitting room photos or videos."));
  if (!snapshot.capabilities.realtimeReady) actions.push(action("realtime", "Restore participant-only live updates before journey tracking or cleaning-progress rehearsal."));
  if (!snapshot.capabilities.geocodingReady) actions.push(action("geocoding", "Configure postcode geocoding before distance-based Cleaner matching."));
  if (!snapshot.capabilities.matchingReady) actions.push(action("matching", "Complete the approved pricing and matching policy before inviting a Cleaner."));
  if (!snapshot.capabilities.automaticDispatchReady) actions.push(action("automatic-dispatch", "Restore the background dispatch worker before testing automatic Cleaner matching."));
  if (!snapshot.capabilities.speechSummaryReady) actions.push(action("speech-summary", "Restore the configured speech-summary provider before testing concise spoken room notes."));
  if (!snapshot.capabilities.roomVisionReady) actions.push(action("room-vision", "Restore the configured room-reading provider before testing assisted scan labels."));
  if (!snapshot.capabilities.emailReady) actions.push(action("transactional-email", "Configure an approved transactional email provider and verified sender, then test only with approved staging inboxes."));
  if (!snapshot.capabilities.paymentsReady) actions.push(action("test-payments", "Configure Stripe test credentials, keep live keys prohibited, enable the test gate and run pnpm run preflight:staging-activation before a payment rehearsal."));
  return Object.freeze(actions);
}

export function liveActivationSnapshot(payload, options = {}) {
  const origin = normalizeLiveActivationOrigin(options.origin);
  const expectedRelease = exact(options.expectedRelease) ? normalizeExpectedReleaseCommit(options.expectedRelease) : null;
  const root = object(payload, "Health response");
  const release = object(root.release, "Health release identity");
  const sourceCommit = normalizeExpectedReleaseCommit(release.sourceCommit);
  if (expectedRelease && sourceCommit !== expectedRelease) throw new Error(`Live release ${sourceCommit} does not match expected release ${expectedRelease}.`);
  if (root.ok !== true || root.service !== "tideway-marketplace") throw new Error("The public health endpoint is not a healthy Homle marketplace service.");
  if (root.dataIntegrity !== "healthy") throw new Error("The public health endpoint reports degraded data integrity.");
  const capabilities = {};
  const marketplace = object(root.marketplace, "Marketplace capability projection");
  for (const name of capabilityNames) capabilities[name] = boolean(marketplace[name], `marketplace.${name}`);
  const snapshot = {
    origin,
    release: Object.freeze({ sourceCommit, migrationCount: Number.isInteger(release.migrationCount) ? release.migrationCount : null }),
    dataIntegrity: root.dataIntegrity,
    writesAllowed: boolean(root.writesAllowed, "writesAllowed"),
    capabilities: Object.freeze(capabilities)
  };
  const coreReady = snapshot.writesAllowed === true && coreBookingCapabilityNames.every((name) => capabilities[name] === true);
  return Object.freeze({
    ok: true,
    ...snapshot,
    readiness: Object.freeze({
      coreBookingRehearsal: coreReady,
      transactionalNotifications: capabilities.emailReady,
      testPaymentRehearsal: coreReady && capabilities.emailReady && capabilities.paymentsReady,
      realPayments: false
    }),
    remainingActions: remainingActions(snapshot)
  });
}

async function boundedText(response) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maximumResponseBytes) throw new Error("Health response exceeded the verification limit.");
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumResponseBytes) throw new Error("Health response exceeded the verification limit.");
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchLiveActivationSnapshot(options = {}) {
  const origin = normalizeLiveActivationOrigin(options.origin);
  const expectedRelease = exact(options.expectedRelease) ? normalizeExpectedReleaseCommit(options.expectedRelease) : null;
  const fetchImplementation = options.fetch || globalThis.fetch;
  if (typeof fetchImplementation !== "function") throw new TypeError("A fetch implementation is required.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 10_000);
  timer.unref?.();
  try {
    const query = expectedRelease ? `?release=${encodeURIComponent(expectedRelease)}` : "";
    const response = await fetchImplementation(`${origin}/api/health${query}`, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "Homle-Live-Activation-Snapshot/1.0" }
    });
    if (response.status !== 200 || !/^application\/json\b/i.test(response.headers.get("content-type") || "")) throw new Error("Public health endpoint did not return a successful JSON response.");
    if (!/(?:^|,)\s*no-store\b/i.test(response.headers.get("cache-control") || "")) throw new Error("Public health endpoint must be non-cacheable.");
    let payload;
    try { payload = JSON.parse(await boundedText(response)); } catch (error) {
      if (error instanceof SyntaxError) throw new Error("Public health endpoint returned invalid JSON.");
      throw error;
    }
    return liveActivationSnapshot(payload, { origin, expectedRelease });
  } finally {
    clearTimeout(timer);
  }
}

function commandOptions(argv, env = process.env) {
  const positional = argv.filter((value) => !value.startsWith("--"));
  const releaseArgument = argv.find((value) => value.startsWith("--expect-release="));
  const unknown = argv.filter((value) => value.startsWith("--") && !value.startsWith("--expect-release="));
  if (unknown.length || positional.length > 1) throw new TypeError("Usage: node tools/live-activation-snapshot.mjs <https-origin> [--expect-release=1234abcd]");
  return {
    origin: positional[0] || env.HOMLE_PUBLIC_ORIGIN,
    expectedRelease: releaseArgument?.slice("--expect-release=".length) || env.HOMLE_EXPECTED_RELEASE_COMMIT
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === toolPath) {
  try {
    console.log(JSON.stringify(await fetchLiveActivationSnapshot(commandOptions(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(`Homle live activation snapshot failed: ${error instanceof Error ? error.message : "Unknown verification failure."}`);
    process.exitCode = 1;
  }
}

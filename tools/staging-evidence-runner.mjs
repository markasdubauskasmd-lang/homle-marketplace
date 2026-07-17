#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMarketplaceDeploymentAdapters } from "../src/marketplace/attachment.mjs";
import { createS3ObjectStorage } from "../src/marketplace/s3-object-storage.mjs";
import { createTransactionalEmailDelivery } from "../src/marketplace/email-delivery.mjs";
import {
  sanitizeStagingServiceProbeError,
  stagingServiceProbeConfirmation,
  validateStagingServiceProbeEnvironment
} from "./staging-service-probe.mjs";

const toolPath = fileURLToPath(import.meta.url);
const emailPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const syntheticPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=", "base64");

function exact(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function stagingEvidenceConfirmation(recipient) {
  return `SEND HOMLE STAGING EVIDENCE TO ${recipient}`;
}

function stagingRecipient(value) {
  const recipient = exact(value);
  const localPart = (recipient.split("@", 1)[0] || "").toLowerCase();
  if (!recipient || recipient.length > 254 || !emailPattern.test(recipient) || !localPart.includes("homle-staging") || /[\u0000-\u0020\u007f]/.test(recipient)) {
    throw new TypeError("HOMLE_STAGING_EVIDENCE_EMAIL must be an approved non-customer mailbox whose local part contains homle-staging.");
  }
  return recipient;
}

export function validateStagingEvidenceEnvironment(env = process.env, confirmation = env.HOMLE_STAGING_EVIDENCE_CONFIRMATION) {
  const recipient = stagingRecipient(env.HOMLE_STAGING_EVIDENCE_EMAIL);
  validateStagingServiceProbeEnvironment(env, stagingServiceProbeConfirmation);
  const required = stagingEvidenceConfirmation(recipient);
  if (confirmation !== required) throw new TypeError("HOMLE_STAGING_EVIDENCE_CONFIRMATION must exactly confirm the approved staging mailbox.");
  return Object.freeze({ recipient });
}

async function boundedResponse(response, maximumBytes = 1_000_000) {
  if (!response?.ok) {
    await response?.body?.cancel?.();
    throw new Error("Synthetic private-media transfer was rejected.");
  }
  const length = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(length) && length > maximumBytes) {
    await response.body?.cancel?.();
    throw new Error("Synthetic private-media response exceeded its evidence limit.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maximumBytes) throw new Error("Synthetic private-media response was empty or oversized.");
  return bytes;
}

async function deleteSyntheticObject(storage, storageKey, cleanup) {
  try {
    await storage.deleteObject({ storageKey });
    cleanup[storageKey.startsWith("quarantine/") ? "quarantineDeleted" : "finalDeleted"] = true;
  } catch (error) {
    cleanup.errors.push(error);
  }
}

export async function runStagingEvidence(options = {}) {
  const env = options.env || process.env;
  const { recipient } = validateStagingEvidenceEnvironment(env, options.confirmation ?? env.HOMLE_STAGING_EVIDENCE_CONFIRMATION);
  const now = options.now || (() => new Date());
  const uuid = options.uuid || randomUUID;
  const fetchImplementation = options.fetch || globalThis.fetch;
  if (typeof fetchImplementation !== "function") throw new TypeError("The staging evidence runner requires fetch.");
  const createAdapters = options.loadAdapters || loadMarketplaceDeploymentAdapters;
  const createEmail = options.createEmail || createTransactionalEmailDelivery;
  const createStorage = options.createStorage || createS3ObjectStorage;
  const requestId = uuid();
  const photoId = uuid();
  const quarantineKey = `quarantine/request-photos/${requestId}/${photoId}`;
  const finalKey = `request-photos/${requestId}/${photoId}.jpg`;
  const sourceChecksum = createHash("sha256").update(syntheticPng).digest("hex");
  const cleanup = { quarantineDeleted: false, finalDeleted: false, errors: [] };
  let adapters;
  let email;
  let storage;
  let evidence;
  let primaryError;

  try {
    adapters = await createAdapters(env);
    if (!adapters || typeof adapters.onUnexpectedError !== "function" || typeof adapters.close !== "function") throw new TypeError("Staging monitoring adapter did not compose completely.");
    email = await createEmail(env, { onUnexpectedError: adapters.onUnexpectedError });
    storage = await createStorage(env, { onUnexpectedError: adapters.onUnexpectedError });
    if (!email || typeof email.verify !== "function" || typeof email.send !== "function" || typeof email.close !== "function") throw new TypeError("Staging SMTP adapter did not compose completely.");
    if (!storage || !["verify", "createUploadUrl", "headObject", "inspectAndSanitizeImage", "createReadUrl", "deleteObject", "close"].every((method) => typeof storage[method] === "function")) throw new TypeError("Staging private-storage adapter did not compose completely.");

    await email.verify();
    await storage.verify();
    const current = now();
    if (!(current instanceof Date) || !Number.isFinite(current.getTime())) throw new TypeError("Staging evidence clock is invalid.");
    const expiresAt = new Date(current.getTime() + 15 * 60_000).toISOString();
    const verification = await email.send({
      kind: "email-verification",
      recipient,
      link: `${env.APP_ORIGIN}/verify-email#token=${uuid().replaceAll("-", "")}`,
      expiresAt
    });
    const reset = await email.send({
      kind: "password-reset",
      recipient,
      link: `${env.APP_ORIGIN}/reset-password#token=${uuid().replaceAll("-", "")}`,
      expiresAt
    });
    if (verification?.accepted !== true || reset?.accepted !== true) throw new Error("Synthetic staging email was not accepted by SMTP.");

    const upload = await storage.createUploadUrl({
      storageKey: quarantineKey,
      mimeType: "image/png",
      byteSize: syntheticPng.length,
      checksumSha256: sourceChecksum,
      expiresAt: new Date(current.getTime() + 5 * 60_000).toISOString()
    });
    const uploadResponse = await fetchImplementation(upload.url, {
      method: "PUT",
      redirect: "error",
      headers: { ...upload.requiredHeaders, "content-length": String(syntheticPng.length) },
      body: syntheticPng
    });
    await uploadResponse.body?.cancel?.();
    if (!uploadResponse.ok) throw new Error("Synthetic private-media upload was rejected.");
    const uploaded = await storage.headObject({ storageKey: quarantineKey });
    if (uploaded.mimeType !== "image/png" || uploaded.byteSize !== syntheticPng.length || uploaded.checksumSha256 !== sourceChecksum) throw new Error("Synthetic private-media upload evidence did not match its source.");

    const sanitized = await storage.inspectAndSanitizeImage({
      sourceStorageKey: quarantineKey,
      targetStorageKey: finalKey,
      sourceMimeType: "image/png",
      maximumBytes: 1_000_000,
      stripMetadata: true
    });
    if (sanitized?.safe !== true || sanitized.outputMimeType !== "image/jpeg" || !/^[a-f0-9]{64}$/.test(sanitized.outputChecksumSha256 || "")) throw new Error("Synthetic private image was not sanitized into a verified JPEG.");
    const finalHead = await storage.headObject({ storageKey: finalKey });
    if (finalHead.mimeType !== "image/jpeg" || finalHead.checksumSha256 !== sanitized.outputChecksumSha256) throw new Error("Synthetic sanitized image metadata did not match its evidence.");
    const read = await storage.createReadUrl({ storageKey: finalKey, expiresAt: new Date(current.getTime() + 3 * 60_000).toISOString() });
    const readBytes = await boundedResponse(await fetchImplementation(read.url, { method: "GET", redirect: "error", headers: { "cache-control": "no-store" } }));
    if (createHash("sha256").update(readBytes).digest("hex") !== sanitized.outputChecksumSha256) throw new Error("Synthetic private image read did not match its sanitized checksum.");

    const monitoringAccepted = await adapters.onUnexpectedError(Object.assign(new Error("homle-managed-staging-synthetic-monitoring-evidence"), { code: "homle-staging-evidence" }), {
      component: "staging-evidence",
      operation: "synthetic-alert",
      job: "launch-readiness",
      consecutiveFailures: 1
    });
    if (monitoringAccepted !== true) throw new Error("Synthetic staging monitoring event was not accepted by the private collector.");
    evidence = { emailAccepted: true, privateImageUploaded: true, privateImageSanitized: true, privateImageReadVerified: true, monitoringDeliveryAccepted: true };
  } catch (error) {
    primaryError = error;
  } finally {
    if (storage) {
      await deleteSyntheticObject(storage, quarantineKey, cleanup);
      await deleteSyntheticObject(storage, finalKey, cleanup);
    }
    try { await email?.close?.(); } catch (error) { cleanup.errors.push(error); }
    try { await storage?.close?.(); } catch (error) { cleanup.errors.push(error); }
    try { await adapters?.close?.(); } catch (error) { cleanup.errors.push(error); }
  }

  if (primaryError || cleanup.errors.length) {
    throw new AggregateError([...(primaryError ? [primaryError] : []), ...cleanup.errors], "Staging evidence failed or synthetic cleanup was incomplete.");
  }
  return Object.freeze({
    ok: true,
    evidence: Object.freeze(evidence),
    cleanup: Object.freeze({ quarantineDeleted: cleanup.quarantineDeleted, finalDeleted: cleanup.finalDeleted }),
    paymentsContacted: false,
    oauthProvidersContacted: false,
    nextEvidence: Object.freeze([
      "Confirm both synthetic messages arrived only in the approved staging mailbox.",
      "Confirm the assigned operator received the synthetic privacy-minimal monitoring alert.",
      "Inspect the private bucket and confirm neither synthetic object remains.",
      "Complete the two-account, two-phone booking rehearsal before public account activation."
    ])
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === toolPath) {
  try {
    console.log(JSON.stringify(await runStagingEvidence(), null, 2));
  } catch (error) {
    const details = error instanceof AggregateError ? error.errors.map((item) => item?.message).filter(Boolean).join(" ") : error?.message;
    console.error(`Homle staging evidence failed: ${sanitizeStagingServiceProbeError(new Error(details || "Unknown staging evidence failure."))}`);
    process.exitCode = 1;
  }
}

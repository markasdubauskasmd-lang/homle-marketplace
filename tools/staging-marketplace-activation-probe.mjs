#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMarketplaceAttachment } from "../src/marketplace/attachment.mjs";
import { sanitizeStagingServiceProbeError, validateStagingServiceProbeEnvironment } from "./staging-service-probe.mjs";

const toolPath = fileURLToPath(import.meta.url);
export const stagingMarketplaceActivationProbeConfirmation = "PROBE HOMLE MANAGED STAGING BOOKINGS AND TEST PAYMENTS";

export async function probeMarketplaceStagingActivation(options = {}) {
  const env = options.env || process.env;
  const confirmation = options.confirmation ?? env.HOMLE_STAGING_SERVICE_PROBE_CONFIRMATION;
  const configuration = validateStagingServiceProbeEnvironment(env, confirmation, {
    expectedConfirmation: stagingMarketplaceActivationProbeConfirmation,
    paymentsMode: "required"
  });
  const createAttachment = options.createAttachment || createMarketplaceAttachment;
  let attachment;
  try {
    attachment = await createAttachment({ env });
    if (!attachment || attachment.enabled !== true || attachment.ready !== true || attachment.authenticationHttpReady !== true || attachment.paymentsReady !== true) {
      throw new Error("Homle staging did not compose ready booking, account and Stripe test-payment boundaries.");
    }
    const capabilities = attachment.authenticationCapabilities || {};
    if (capabilities.emailPassword !== true || capabilities.emailVerification !== true || capabilities.passwordReset !== true) {
      throw new Error("Homle staging email account capabilities did not attach completely for booking notifications and recovery.");
    }
    return Object.freeze({
      ok: true,
      database: configuration.database,
      probes: Object.freeze({
        databaseSchemaAndRole: true,
        realtimeDatabaseSession: true,
        transactionalEmail: true,
        privateRoomMedia: true,
        monitoringAdapter: true,
        authenticationRuntime: true,
        stripeTestPlatform: true,
        businessRecordsCreated: false,
        paymentObjectsCreated: false
      }),
      providers: Object.freeze({
        google: capabilities.google === true,
        apple: capabilities.apple === true,
        facebook: capabilities.facebook === true,
        stripe: Object.freeze({ ready: true, testMode: true })
      }),
      nextEvidence: Object.freeze([
        "Complete approved Landlord and Cleaner onboarding in separate mobile browser sessions.",
        "Create one synthetic property and room scan, then prove private upload, Cleaner-only accepted-booking access and cleanup.",
        "Run one synthetic request through matching, acceptance, payment authorization, journey, checklist completion and review.",
        "Reconcile Stripe test webhooks for capture, Cleaner transfer, reversal and refund before any public launch."
      ])
    });
  } finally {
    await attachment?.close?.();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === toolPath) {
  try {
    console.log(JSON.stringify(await probeMarketplaceStagingActivation(), null, 2));
  } catch (error) {
    console.error(`Homle staging booking/payment activation probe failed: ${sanitizeStagingServiceProbeError(error)}`);
    process.exitCode = 1;
  }
}

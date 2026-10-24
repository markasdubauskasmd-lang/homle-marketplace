import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Client, Pool } from "pg";
import { createMarketplaceDatabase } from "../src/marketplace/database.mjs";
import { createCleaningRequestRepository } from "../src/marketplace/cleaning-request-repository.mjs";
import { createCleaningRequestService } from "../src/marketplace/cleaning-request-service.mjs";
import { createBookingRepository } from "../src/marketplace/booking-repository.mjs";
import { createBookingPricingPolicy, createBookingWorkflowService } from "../src/marketplace/booking-workflow.mjs";
import { quoteRooms } from "../public/pricing-engine.js";
import { defaultPricingConfig } from "../public/pricing-config.js";
import { defaultPricingEconomics, reviewedQuote } from "../src/marketplace/pricing-economics.mjs";

assert.equal(process.env.TIDEWAY_DATABASE_TEST_CONFIRMATION, "RUN TIDEWAY DISPOSABLE DATABASE TESTS");
const ownerUrl = new URL(process.env.DATABASE_INTEGRATION_OWNER_URL);
const appUrl = new URL(process.env.DATABASE_INTEGRATION_APP_URL);
assert(/_tideway_test$/.test(ownerUrl.pathname));
assert.equal(ownerUrl.pathname, appUrl.pathname);
assert.equal(ownerUrl.host, appUrl.host);
assert.notEqual(ownerUrl.username, appUrl.username);
const owner = new Client({ connectionString: ownerUrl.toString() });
const pool = new Pool({ connectionString: appUrl.toString(), max: 2 });
const landlord = { userId: "10000000-0000-4000-8000-000000000001", roles: ["landlord"] };
const cleanerId = "10000000-0000-4000-8000-000000000002";
const requestId = "30000000-0000-4000-8000-000000000004";
const sqlFile = async name => (await readFile(new URL("../db/integration/" + name, import.meta.url), "utf8")).replace(/^\\set ON_ERROR_STOP on\r?\n/, "");
let created = false;
try {
  await owner.connect();
  assert((await owner.query("SELECT current_database() AS name")).rows[0].name.endsWith("_tideway_test"));
  assert.equal((await owner.query("SELECT count(*)::int AS count FROM users WHERE id=$1", [landlord.userId])).rows[0].count, 0);
  await owner.query(await sqlFile("marketplace-integration-setup.sql"));
  created = true;
  const role = (await pool.query("SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
  assert.equal(role.name, decodeURIComponent(appUrl.username));
  assert.equal(role.rolsuper, false);
  assert.equal(role.rolbypassrls, false);
  await owner.query("INSERT INTO cleaner_services(cleaner_user_id,service_code,pricing_model,price_pence) VALUES($1,'regular-domestic','hourly',2500)", [cleanerId]);
  const database = createMarketplaceDatabase(pool);
  const pricingRequest = { serviceType: "standard", frequency: "one-time", requestedMinutes: 120, rooms: [{ roomType: "kitchen", items: [] }] };
  const expected = reviewedQuote(quoteRooms(pricingRequest, defaultPricingConfig), defaultPricingEconomics).quote;
  assert.equal(expected.priceable, true);
  const requestService = createCleaningRequestService(createCleaningRequestRepository(database), {
    quotePlatformRequest: async (_actor, input) => reviewedQuote(quoteRooms(input, defaultPricingConfig), defaultPricingEconomics).quote
  });
  const now = Date.now();
  const saved = await requestService.createOwnRequest(landlord, {
    id: requestId, propertyId: "20000000-0000-4000-8000-000000000003",
    requestedStartAt: new Date(now + 48 * 3600000).toISOString(),
    requestedEndAt: new Date(now + 50 * 3600000).toISOString(),
    cleaningType: "regular-domestic", requiredServices: ["regular-domestic"], frequency: "one-time",
    tasks: [{ roomName: "Kitchen", description: "Clean worktops" }], pricingRequest
  });
  assert.equal(saved.quotedTotalPence, expected.totalPence);
  await requestService.submitOwnRequest(landlord, requestId, { scopeReviewed: true, cleanerPreviewAuthorized: false });
  const stored = (await owner.query("SELECT quoted_total_pence,quoted_minutes,pricing_config_version FROM cleaning_requests WHERE id=$1", [requestId])).rows[0];
  assert.equal(stored.quoted_total_pence, expected.totalPence);
  const repository = createBookingRepository(database);
  const candidate = await repository.getInvitationCandidate(landlord, requestId, cleanerId);
  assert(candidate, "Saved request did not reach invitation candidate");
  const workflow = createBookingWorkflowService(repository, {
    pricingPolicy: createBookingPricingPolicy({ targetMarginBasisPoints: 2000, minimumContributionPence: 600, paymentFeeBasisPoints: 150, paymentFeeFixedPence: 20, invitationTtlMinutes: 180 }),
    platformEconomics: defaultPricingEconomics
  });
  const preview = await workflow.previewInvitation(landlord, { cleaningRequestId: requestId, cleanerId });
  console.log("QUOTE_HANDOFF_EVIDENCE " + JSON.stringify({
    savedTotalPence: saved.quotedTotalPence, databaseTotalPence: stored.quoted_total_pence,
    candidateTotalPence: candidate.quoted_total_pence ?? null, invitationTotalPence: preview.customerPricePence,
    savedVersion: stored.pricing_config_version, candidateVersion: candidate.pricing_config_version ?? null
  }));
  assert.equal(preview.customerPricePence, expected.totalPence, "Saved customer quote changed at the real invitation handoff");
  assert.equal(candidate.quoted_total_pence, stored.quoted_total_pence, "Invitation candidate omitted the stored quote");
  assert.equal(candidate.quoted_minutes, stored.quoted_minutes);
  assert.equal(candidate.pricing_config_version, stored.pricing_config_version);
  console.log("Real database quote handoff passed: saved request, runtime-role candidate and invitation share the same total and version.");
} finally {
  try {
    await owner.query("ROLLBACK");
    if (created) await owner.query(await sqlFile("marketplace-integration-cleanup.sql"));
  } finally { await pool.end(); await owner.end(); }
}

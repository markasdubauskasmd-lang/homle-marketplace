import { readFile } from "node:fs/promises";
import {
  journeySteps,
  stepIndex,
  stepLabel,
  railState,
  previousStep,
  normalisedPostcode,
  postcodeMessage,
  supplyMessage,
  services,
  isKnownService,
  bookableDays,
  arrivalWindows,
  frequencies,
  durationChoices,
  suggestedDurationMinutes,
  matchingProperties,
  journeyAccountState,
  rankedAvailableCleaners,
  bestAvailableCleaner,
  firstQuoteVerifiedCleaner,
  canLeaveStep,
  blockedReason,
  checkoutMode,
  checkoutCopy
} from "../public/landlord-journey-model.js";

function assert(condition, message) { if (!condition) throw new Error(message); }

const [page, script, styles, server, scanPage] = await Promise.all([
  readFile(new URL("../public/landlord-journey.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-journey.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/room-scan.html", import.meta.url), "utf8")
]);

// Six steps, starting at the postcode, exactly as approved.
assert(journeySteps.length === 6 && journeySteps[0].id === "postcode", "The journey does not begin with the postcode step.");
assert(journeySteps.map((step) => step.id).join(",") === "postcode,service,results,when,cleaner,checkout", `The step order changed: ${journeySteps.map((s) => s.id).join(",")}`);
assert(stepLabel("postcode") === "Step 1 / 6" && stepLabel("checkout") === "Step 6 / 6", "The rail does not count steps out of six.");
assert(previousStep("postcode") === "" && previousStep("service") === "postcode", "Back navigation is wrong at the first step.");

// The rail shows what is done, what is current and what is still ahead.
assert(railState("results").join(",") === "done,done,now,,,", `The progress rail is wrong mid-journey: ${railState("results").join(",")}`);

// Only the outward code is needed to find cleaners, and the step accepts a
// postcode typed either way.
assert(normalisedPostcode("sm4 4le").outward === "SM4" && normalisedPostcode("SM44LE").outward === "SM4", "A valid postcode was rejected or its outward code misread.");
assert(normalisedPostcode("SM4").outward === "SM4" && normalisedPostcode("SM4").full === "", "An outward-only postcode was not accepted before a price has been seen.");
assert(normalisedPostcode("hello") === null && postcodeMessage("hello").includes("postcode"), "An invalid postcode was accepted or unexplained.");
assert(postcodeMessage("") === "", "An empty postcode field was treated as an error before anything was typed.");

// Coverage must state what the directory actually returned; nothing is dressed up.
assert(supplyMessage(14, "SM4").headline === "14 cleaners near SM4" && supplyMessage(1, "SM4").headline === "1 cleaner near SM4", "The coverage line does not report the real number.");
const none = supplyMessage(0, "SM4");
assert(!none.available && none.headline.includes("No cleaners") && none.detail.includes("save your request"), "Having no cleaners in an area is hidden instead of said plainly.");

// A step cannot be left with a gap the next one needs.
assert(!canLeaveStep("postcode", {}) && canLeaveStep("postcode", { postcode: "SM4 4LE" }), "The postcode gate is wrong.");
assert(!canLeaveStep("service", { serviceCode: "invented" }) && canLeaveStep("service", { serviceCode: services[0].code }), "An unpriceable service could be chosen.");
assert(!canLeaveStep("results", { tasks: [] }) && canLeaveStep("results", { tasks: ["Mop the floor"] }), "The journey could reach checkout with an empty checklist.");
assert(!canLeaveStep("when", { date: "2026-08-01", time: "25:00", frequency: "fortnightly" }), "An impossible arrival window was accepted.");
assert(canLeaveStep("when", { date: "2026-08-01", time: arrivalWindows[0], frequency: frequencies[0].code, durationMinutes: durationChoices[0] }), "A complete timing answer was rejected.");
assert(!canLeaveStep("cleaner", {}) && canLeaveStep("cleaner", { cleanerId: "abc" }), "The journey could reach checkout with no cleaner chosen.");
for (const step of ["postcode", "service", "results", "when", "cleaner"]) {
  assert(blockedReason(step, {}).length > 8, `Step ${step} blocks the Landlord without telling them why.`);
}

// Every offered day is in the future.
const days = bookableDays(new Date("2026-07-20T09:00:00Z"));
assert(days.length === 14 && days[0].iso === "2026-07-21", `Bookable days do not start tomorrow: ${days[0].iso}`);
assert(isKnownService(services[0].code) && !isKnownService("anything"), "Service codes are not validated against what the marketplace can price.");
assert(services.map((service) => service.code).join(",") === "regular-domestic,deep-cleans,end-of-tenancy,workplaces", "The booking journey offers a service code the marketplace request contract cannot accept.");
assert(frequencies.map((frequency) => frequency.code).join(",") === "weekly,fortnightly,every-four-weeks,one-time", "The booking journey offers a recurrence code the marketplace request contract cannot accept.");
assert(suggestedDurationMinutes(Array(8).fill("task")) === 120 && suggestedDurationMinutes(Array(16).fill("task")) === 180, "The checklist did not produce a bounded editable duration suggestion.");
const savedProperties = [
  { propertyId: "one", exactAddress: { postcode: "SM4 4LE" } },
  { propertyId: "two", exactAddress: { postcode: "SW1A 1AA" } }
];
assert(matchingProperties(savedProperties, "SM4").map((property) => property.propertyId).join(",") === "one" && matchingProperties(savedProperties, "SM4 4LE")[0].propertyId === "one", "The journey cannot safely reuse a signed-in Landlord's matching property.");
assert(journeyAccountState(null) === "signed-out" && journeyAccountState({ roles: [] }) === "role-required" && journeyAccountState({ roles: ["cleaner"] }) === "role-required" && journeyAccountState({ roles: ["cleaner", "landlord"] }) === "ready", "The camera journey does not distinguish a missing session, a separate Cleaner-only workspace and an authorized Landlord.");
const recommended = bestAvailableCleaner({ candidates: [
  { cleanerId: "22222222-2222-4222-8222-222222222222", displayName: "Current best match" },
  { cleanerId: "33333333-3333-4333-8333-333333333333", displayName: "Second match" }
] });
assert(recommended?.cleanerId === "22222222-2222-4222-8222-222222222222" && recommended.displayName === "Current best match", "The marketplace choice does not resolve to the server-ranked first eligible Cleaner.");
const alternative = bestAvailableCleaner({ candidates: [
  { cleanerId: "22222222-2222-4222-8222-222222222222", displayName: "Unavailable first match" },
  { cleanerId: "33333333-3333-4333-8333-333333333333", displayName: "Next eligible match" }
] }, { excludeCleanerId: "22222222-2222-4222-8222-222222222222" });
assert(alternative?.cleanerId === "33333333-3333-4333-8333-333333333333" && alternative.displayName === "Next eligible match", "The guided journey cannot safely choose the next server-ranked eligible Cleaner after excluding an unavailable selection.");
const rankedAlternatives = rankedAvailableCleaners({ candidates: [
  { cleanerId: "22222222-2222-4222-8222-222222222222", displayName: "Unavailable selected Cleaner", payoutReady: false },
  { cleanerId: "33333333-3333-4333-8333-333333333333", displayName: "First replacement", providerAccountId: "private-provider-account" },
  { cleanerId: "33333333-3333-4333-8333-333333333333", displayName: "Duplicate replacement" },
  { cleanerId: "not-a-cleaner", displayName: "Malformed candidate" },
  { cleanerId: "44444444-4444-4444-8444-444444444444", displayName: "Second replacement" }
] }, { excludeCleanerIds: ["22222222-2222-4222-8222-222222222222"] });
assert(rankedAlternatives.length === 2 && rankedAlternatives[0].cleanerId === "33333333-3333-4333-8333-333333333333" && rankedAlternatives[1].cleanerId === "44444444-4444-4444-8444-444444444444", "The replacement search lost server rank, retained the failed Cleaner, duplicated a candidate or accepted a malformed identity.");
assert(!JSON.stringify(rankedAlternatives).includes("payoutReady") && !JSON.stringify(rankedAlternatives).includes("providerAccountId"), "The replacement projection exposed private payout readiness or provider-account material.");
const quoteAttempts = [];
const quoteVerifiedAlternative = await firstQuoteVerifiedCleaner(rankedAlternatives, async (candidate) => {
  quoteAttempts.push(candidate.cleanerId);
  if (quoteAttempts.length === 1) throw Object.assign(new Error("Payout setup changed"), { code: "cleaner-payout-not-ready" });
  return 2599;
});
assert(quoteVerifiedAlternative?.cleaner.cleanerId === "44444444-4444-4444-8444-444444444444" && quoteVerifiedAlternative.customerPricePence === 2599 && quoteAttempts.length === 2, "A payout-readiness race did not advance to the next server-ranked Cleaner and preserve the fresh exact quote.");
const boundedCandidates = rankedAvailableCleaners({ candidates: Array.from({ length: 6 }, (_, index) => ({
  cleanerId: `${String(index + 1).repeat(8)}-${String(index + 1).repeat(4)}-4${String(index + 1).repeat(3)}-8${String(index + 1).repeat(3)}-${String(index + 1).repeat(12)}`,
  displayName: `Candidate ${index + 1}`
})) });
let boundedAttempts = 0;
assert(await firstQuoteVerifiedCleaner(boundedCandidates, async () => {
  boundedAttempts += 1;
  throw Object.assign(new Error("Payout setup changed"), { code: "cleaner-payout-not-ready" });
}) === null && boundedAttempts === 5, "Alternative quote verification was unbounded or invented a quote after every bounded candidate became unavailable.");
let unrelatedQuoteFailure = "";
try {
  await firstQuoteVerifiedCleaner(rankedAlternatives, async () => { throw Object.assign(new Error("Matching service unavailable"), { code: "matching-unavailable" }); });
} catch (error) {
  unrelatedQuoteFailure = error.code;
}
assert(unrelatedQuoteFailure === "matching-unavailable", "Alternative quote verification swallowed an unrelated matching failure and risked an unverified invitation.");
assert(bestAvailableCleaner({ candidates: [] }) === null && bestAvailableCleaner({ candidates: [{ cleanerId: "not-a-cleaner" }] }) === null, "An empty or malformed match response invented an eligible Cleaner.");

// Payments are a deployment switch. With them off the journey must say what
// will really happen instead of showing a pay button that cannot charge.
assert(checkoutMode({ paymentsReady: true, matchingReady: true }) === "request", "The journey tries to charge before a Cleaner has accepted a booking.");
assert(checkoutMode({ paymentsReady: false, matchingReady: true }) === "request", "Checkout does not fall back to sending a request when payments are off.");
assert(checkoutMode({}) === "save", "Checkout does not fall back to saving when nothing is configured.");
assert(checkoutCopy("save").note.includes("no payment is taken"), "A saved request implies a payment was taken.");
assert(checkoutCopy("request").note.includes("No payment is taken"), "An unpaid request implies a payment was taken.");
assert(!checkoutCopy("request").note.includes("invited now") && checkoutCopy("request").note.includes("exact quoted total"), "Checkout promises a Cleaner invitation before the required exact-price approval.");

// The page itself: step 1 is the postcode question from the approved design.
assert(page.includes("Where are we cleaning") && page.includes("Let&#39;s check who&#39;s") || page.includes("Let's check who's"), "Step 1 is not the approved postcode question.");
assert(page.includes("exact address stays private") && page.includes("Private account") && page.includes("Nothing sent before approval") && page.includes("No payment on this step"), "The step 1 privacy and approval boundaries are missing.");
assert(!page.includes("Enhanced DBS") && !page.includes("Insured incl. theft") && !page.includes("Free cancellation 24h") && !page.includes("cancel free up to"), "The booking journey invents unverified screening, insurance or cancellation claims.");
assert(page.includes("data-rail") && page.includes("data-step-label") && page.includes("data-back"), "The progress rail is missing.");
assert(styles.includes(".rail-seg") && styles.includes(".rail-lbl") && styles.includes(".jstep"), "The journey presentation is missing.");
assert(page.includes("/styles.css?v=20260723-1") && page.includes("/landlord-journey.js?v=journey8") && script.includes("./landlord-journey-model.js?v=journey7"), "The repaired mobile journey, shared animation layer or matching model can remain stuck behind previous cached assets.");
assert(page.includes("data-access-gate") && page.includes("data-journey-shell hidden") && page.includes('href="/signup?intent=book" data-access-sign-in'), "A copied or installed-app booking link can expose the scanner before secure Landlord access is checked.");
assert(script.includes('location.replace("/signup?intent=book")') && script.includes('location.replace("/onboarding?intent=book")') && script.includes("openAuthenticatedJourney") && script.includes('access.status !== "ready"'), "The booking journey does not recover account-first entry, add the separate Landlord role, or fail closed before opening the scanner.");
assert(script.indexOf("await openAuthenticatedJourney()") < script.lastIndexOf("show(state.step)"), "The room-scan journey is rendered before the signed-in Landlord workspace is verified.");

// The scan is an interstitial in the journey, not a dead end.
assert(page.includes("data-scan-link") && script.includes("openRoomScan"), "The journey never offers the room scan.");
assert(page.includes("data-scan-prereq") && script.includes("el.scanLink.disabled = !serviceSelected") && script.includes("el.scanPrereq.hidden = serviceSelected"), "The scan button still looks broken before the required cleaning type is selected.");
assert(scanPage.includes("/landlord/book") || script.includes("await openRoomScan()"), "Leaving the scan does not return to the journey.");
assert(script.includes("await openRoomScan()") && script.includes("state.draft.tasks = Array.isArray(result.tasks)"), "A finished scan does not hand its checklist straight back to the journey.");
assert(script.includes("state.scanPhotos = Array.isArray(result.photos)") && script.includes("/photos/intents") && script.includes("/submit") && script.includes("cleanerPreviewAuthorized"), "The finished scan loses its private room photos or cannot securely submit them with the reviewed checklist.");
assert(page.includes('target="_blank" rel="noopener" data-property-sign-in') && script.includes('error?.code === "authentication-required"') && script.includes("Your room photos and answers remain in this tab"), "An expired session can strand the final scan or force navigation that destroys its in-memory room photos.");
assert(/async function recoverCsrf\(\)[\s\S]{0,300}requestJson\("\/api\/marketplace\/auth\/session"/.test(script) && !/async function recoverCsrf\(\)[\s\S]{0,120}if \(current\) return current/.test(script), "The final booking action can reuse an editing token from an older session instead of rotating it before any write.");

// A long journey must survive a refresh or an interruption.
assert(script.includes("homle_journey_draft") && script.includes("restoreDraft"), "Answers are lost if the Landlord refreshes or is interrupted.");
assert(script.includes('requestJson("/api/marketplace/properties"') && script.includes("createOrRecoverProperty") && script.includes("propertyId") && script.includes("requestedWindow(") && script.includes("requiredServices") && script.includes("submit: false"), "The redesigned journey still posts an incomplete request instead of using the authenticated property and canonical marketplace contract.");
assert(page.includes("data-property-options") && page.includes("data-property-new") && page.includes("data-duration"), "The journey cannot choose/create the required private property or approve an exact requested duration.");
assert(script.includes("/invitation-quote") && script.includes("approvedCustomerPricePence") && script.includes("No payment is taken now"), "A selected Cleaner can be invited without exact-price approval or the journey implies premature payment.");
assert(script.includes("/matches") && script.includes("bestAvailableCleaner(matches, { excludeCleanerId })") && script.includes("const best = await loadBestEligibleCleaner(requestId)") && script.includes("price = await loadInvitationQuote(csrf, requestId, cleanerId)"), "Choosing the best available Cleaner submits the request but never resolves the current server-ranked match before quoting.");
assert(script.includes("No eligible Cleaner is available for the exact time and scope yet") && script.includes("No invitation or payment was created"), "An empty or unavailable marketplace result does not preserve the open request honestly.");
assert(script.includes("function cleanerInvitationRecovery(error)") && script.includes('error?.code === "cleaner-payout-not-ready"') && script.includes("loadQuoteVerifiedAlternative(csrf, requestId, [initiallySelectedCleanerId])") && script.includes("Invite ${cleanerName} instead for exactly") && script.includes("No payment is taken now") && script.includes("invitation.reason = cleanerInvitationRecovery(error)"), "The guided booking journey does not offer a fresh exact-price alternative or preserve the submitted request after a payout-readiness rejection.");
assert(script.includes("rankedAvailableCleaners(matches, { excludeCleanerIds })") && script.includes("firstQuoteVerifiedCleaner(candidates") && script.includes("loadInvitationQuote(csrf, requestId, candidate.cleanerId)"), "Replacement matching bypasses the bounded, executable exact-quote verifier.");
const invitationFlow = script.slice(script.indexOf("async function inviteSelectedCleaner"), script.indexOf("async function confirmJourney"));
assert(invitationFlow.indexOf("const approved = window.confirm(approvalMessage)") < invitationFlow.indexOf("await sendCleanerInvitation(csrf, requestId, cleanerId, price)"), "A selected or quote-recovered Cleaner can be invited before the Landlord explicitly approves the exact price.");
assert(invitationFlow.includes("That Cleaner became unavailable before the offer was sent") && invitationFlow.includes("loadQuoteVerifiedAlternative(csrf, requestId, [initiallySelectedCleanerId, cleanerId])") && invitationFlow.includes("No invitation or payment was created for ${unavailableCleanerName}"), "A quote-to-invitation payout race still strands the submitted request or implies that an offer/payment was created.");
assert(invitationFlow.indexOf("const replacementApproved = window.confirm") < invitationFlow.lastIndexOf("await sendCleanerInvitation") && invitationFlow.includes("if (!replacementApproved) return { invited: false") && invitationFlow.includes("No invitation, booking or payment exists"), "A post-approval replacement can be invited without a second exact-price approval or declining it can create marketplace state.");
assert((invitationFlow.match(/await sendCleanerInvitation/g) || []).length === 2 && (invitationFlow.match(/loadQuoteVerifiedAlternative/g) || []).length === 2, "The guided journey can retry invitation writes or replacement searches without the intended bounded decisions.");
assert(script.includes("excludeCleanerIds") && script.includes("initiallySelectedCleanerId") && !script.includes("payoutReady:"), "The alternative-match recovery can retry the unavailable Cleaner or expose a private payout-readiness flag.");
assert(script.includes("new AbortController()") && script.includes("120_000") && script.includes("photo upload took too long"), "A stalled mobile room-photo upload can leave checkout spinning indefinitely.");

// Coverage and cleaners come from the live directory, never from a placeholder.
assert(script.includes("/api/marketplace/cleaners?outwardPostcode=") && script.includes("payload?.cleaners"), "Coverage is not read from the real Cleaner directory.");
assert(!/\b14 cleaners\b/.test(script), "A placeholder cleaner count is hardcoded in the journey.");

// Guide time must stay a range, as on the scan.
assert(script.includes("function guideRange") && script.includes("–"), "Guide time is presented as a single confident figure.");

assert(server.includes('"/landlord/book": "landlord-journey.html"'), "The journey page is not served.");

console.log("Landlord journey UI tests passed: six approved steps from the postcode, honest coverage from the live directory, gated progress with reasons, future-only days, scan handoff both ways, draft recovery and a checkout that states what will really happen.");

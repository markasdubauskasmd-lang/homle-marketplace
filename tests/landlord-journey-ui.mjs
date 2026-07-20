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
assert(canLeaveStep("when", { date: "2026-08-01", time: arrivalWindows[0], frequency: frequencies[0].code }), "A complete timing answer was rejected.");
assert(!canLeaveStep("cleaner", {}) && canLeaveStep("cleaner", { cleanerId: "abc" }), "The journey could reach checkout with no cleaner chosen.");
for (const step of ["postcode", "service", "results", "when", "cleaner"]) {
  assert(blockedReason(step, {}).length > 8, `Step ${step} blocks the Landlord without telling them why.`);
}

// Every offered day is in the future.
const days = bookableDays(new Date("2026-07-20T09:00:00Z"));
assert(days.length === 14 && days[0].iso === "2026-07-21", `Bookable days do not start tomorrow: ${days[0].iso}`);
assert(isKnownService(services[0].code) && !isKnownService("anything"), "Service codes are not validated against what the marketplace can price.");

// Payments are a deployment switch. With them off the journey must say what
// will really happen instead of showing a pay button that cannot charge.
assert(checkoutMode({ paymentsReady: true, matchingReady: true }) === "pay", "Checkout does not take payment when payments are live.");
assert(checkoutMode({ paymentsReady: false, matchingReady: true }) === "request", "Checkout does not fall back to sending a request when payments are off.");
assert(checkoutMode({}) === "save", "Checkout does not fall back to saving when nothing is configured.");
assert(checkoutCopy("save").note.includes("no payment is taken"), "A saved request implies a payment was taken.");
assert(checkoutCopy("request").note.includes("No payment is taken"), "An unpaid request implies a payment was taken.");
assert(checkoutCopy("pay").action === "Confirm and pay", "A live payment is not named plainly.");

// The page itself: step 1 is the postcode question from the approved design.
assert(page.includes("Where are we cleaning") && page.includes("Let&#39;s check who&#39;s") || page.includes("Let's check who's"), "Step 1 is not the approved postcode question.");
assert(page.includes("No name, no address, no card") && page.includes("Enhanced DBS") && page.includes("Insured incl. theft") && page.includes("Free cancellation 24h"), "The step 1 promise or trust chips are missing.");
assert(page.includes("data-rail") && page.includes("data-step-label") && page.includes("data-back"), "The progress rail is missing.");
assert(styles.includes(".rail-seg") && styles.includes(".rail-lbl") && styles.includes(".jstep"), "The journey presentation is missing.");

// The scan is an interstitial in the journey, not a dead end.
assert(page.includes("data-scan-link") && script.includes("openRoomScan"), "The journey never offers the room scan.");
assert(scanPage.includes("/landlord/book") || script.includes("await openRoomScan()"), "Leaving the scan does not return to the journey.");
assert(script.includes("await openRoomScan()") && script.includes("state.draft.tasks = Array.isArray(result.tasks)"), "A finished scan does not hand its checklist straight back to the journey.");

// A long journey must survive a refresh or an interruption.
assert(script.includes("homle_journey_draft") && script.includes("restoreDraft"), "Answers are lost if the Landlord refreshes or is interrupted.");

// Coverage and cleaners come from the live directory, never from a placeholder.
assert(script.includes("/api/marketplace/cleaners?outwardPostcode=") && script.includes("payload?.cleaners"), "Coverage is not read from the real Cleaner directory.");
assert(!/\b14 cleaners\b/.test(script), "A placeholder cleaner count is hardcoded in the journey.");

// Guide time must stay a range, as on the scan.
assert(script.includes("function guideRange") && script.includes("–"), "Guide time is presented as a single confident figure.");

assert(server.includes('"/landlord/book": "landlord-journey.html"'), "The journey page is not served.");

console.log("Landlord journey UI tests passed: six approved steps from the postcode, honest coverage from the live directory, gated progress with reasons, future-only days, scan handoff both ways, draft recovery and a checkout that states what will really happen.");

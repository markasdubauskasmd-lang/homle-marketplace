/*
 * The booking journey's local draft must not outlive the retention the product
 * promises for it.
 *
 * `public/privacy.html` tells the customer that an incomplete cleaning request
 * keeps its property scope, timing, access and contact entries in the current
 * browser tab "for up to 30 minutes", and is removed after successful
 * submission, EXPIRY, explicit discard or tab closure. The same promise appears
 * on the landing page and the Landlord dashboard.
 *
 * `landlord-journey.js` wrote no timestamp and read none, so the draft lived for
 * the life of the tab. Ten sibling draft modules implement the expiry; the
 * journey — the one that holds the most, including the address, the access
 * notes and the dictated transcript — was the outlier. That is a published
 * retention statement the code did not honour, which is a legal exposure rather
 * than a UX nit, so it is asserted here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { landlordRequestDraftLifetimeMs } from "../public/landlord-request-draft.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const journey = read("public/landlord-journey.js");

/* ── The promise, read from the pages that make it ── */

const promises = [
  ["public/privacy.html", "the privacy notice"],
  ["public/home.html", "the landing page"],
  ["public/landlord-dashboard.html", "the Landlord dashboard"]
];
for (const [path, where] of promises) {
  assert.match(
    read(path).replace(/\s+/g, " "),
    /up to 30 minutes/,
    `${where} no longer states the 30-minute draft retention. If the promise changed, this test and the lifetime constant must change with it — do not delete the assertion to make it pass.`
  );
}
assert.equal(
  landlordRequestDraftLifetimeMs,
  30 * 60 * 1000,
  "The shared draft lifetime no longer matches the 30 minutes the product promises its customers."
);

/* ── The journey honours it ── */

assert.match(
  journey,
  /import \{ landlordRequestDraftLifetimeMs \}/,
  "The booking journey no longer imports the shared draft lifetime. Restating the number is how one promise becomes two."
);
assert.match(
  journey,
  /savedAt,\s*expiresAt:\s*savedAt \+ landlordRequestDraftLifetimeMs/,
  "The booking journey saves its draft without an expiry stamp, so nothing can tell whether it is inside the promised window."
);

// The read path is the one that matters: a stamp nobody checks is decoration.
const restore = journey.slice(journey.indexOf("function restoreDraft()"), journey.indexOf("// A finished room scan hands its checklist here."));
assert.match(restore, /Date\.now\(\) < expiresAt/, "The booking journey restores a draft without checking it has not expired.");
assert.match(restore, /discardDraft\(\)/, "An expired draft is not discarded, so it stays in storage past the promised window even if it is not shown.");
assert.match(
  restore,
  /expiresAt === savedAt \+ landlordRequestDraftLifetimeMs/,
  "The journey accepts any expiry a stored draft claims. A draft carrying a longer window than the product promises must be refused, not honoured."
);
assert.match(
  restore,
  /Date\.now\(\) >= savedAt - 5 \* 60 \* 1000/,
  "A draft stamped in the future is accepted. A clock change must not extend the retention window."
);

/* ── And on the way out ── */

assert.ok(
  journey.includes("function discardDraft()") && (journey.match(/discardDraft\(\)/g) || []).length >= 3,
  "The journey no longer has one owner for discarding the draft — it is defined once and used on expiry and on successful submission."
);

console.log("Journey draft retention tests passed: the 30-minute promise is stated on all three pages that make it, the shared lifetime matches it, and the booking journey stamps its draft, refuses one that is expired, unstamped, over-long or future-dated, and discards it in every case.");




// Execute recovery against the existing authenticated session response.
{
  const { default: vm } = await import("node:vm");
  const { journeyAccountState } = await import("../public/landlord-journey-model.js");
  const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
  const initial = {
    step: "postcode", signedIn: false, draftOwner: "", properties: [], confirming: false,
    draft: { propertyId: "", durationMinutes: 120, tasks: [], transcript: "", serviceCode: "" },
    scanPhotos: [], scanRooms: [], scanPremiumPlan: { options: [], groups: [], baseTasks: [] },
    scanPremiumSelected: [], scanSessionId: "", scanCorrections: [], scanReview: null,
    scanInstructions: [], scanNoteEdits: {}, scanGeneralNote: "", scanMeasurements: []
  };
  const storedDraft = (ownerId=A, age=1000) => { const savedAt=Date.now()-age; return { ownerId, step: "results", savedAt,
    expiresAt: savedAt+landlordRequestDraftLifetimeMs,
    draft: { propertyId: A, durationMinutes: 120, tasks: ["Kitchen: private synthetic task"], transcript: "Private synthetic access note" } }; };
  function harness(stored, owner=A) {
    const values = new Map(stored == null ? [] : [["homle_journey_draft", typeof stored === "string" ? stored : JSON.stringify(stored)]]);
    const state = structuredClone(initial), responses = { owner, failure: false }, calls = [];
    const el = { accessRetry: {}, accessSignIn: {}, accessTitle: {}, accessCopy: {}, accessGate: {},
      journeyShell: [{ hidden: true }] };
    const context = vm.createContext({ state, el, Date, JSON, Number, Object, draftKey: "homle_journey_draft",
      landlordRequestDraftLifetimeMs, durationChoices: [120], journeyAccountState,
      sessionStorage: { getItem:k=>values.get(k)||null, setItem:(k,v)=>values.set(k,v), removeItem:k=>values.delete(k) },
      stepIndex:s=>["postcode","service","results","when","cleaner","checkout"].indexOf(s),
      normalisedPostcode:value=>value?{ full:value }:null,
      renderServices(){}, toast(){}, closeMeasure(){ calls.push("close-measure"); },
      suggestedDurationMinutes:()=>120, saveCsrf:()=>true,
      requestJson:async path=>{
        calls.push(path);
        if(responses.failure) throw Object.assign(new Error("Synthetic offline"),{statusCode:503});
        const account={userId:responses.owner,roles:["landlord"]};
        if(path.endsWith("/auth/session")) return {csrfToken:"synthetic-csrf",account};
        if(path.endsWith("/account")) return {account};
        if(path.endsWith("/properties")) return {properties:[{propertyId:responses.owner,exactAddress:{postcode:"SW1A 1AA"}}]};
        throw new Error("Unexpected request "+path);
      },
      location:{replace(){throw new Error("Unexpected redirect");}}
    });
    const section=(from,to)=>journey.slice(journey.indexOf(from),journey.indexOf(to,journey.indexOf(from)));
    vm.runInContext(section("const emptyPrivateJourney =", "// Core account")
      + section("async function recoverCsrf()", "// The journey is long enough")
      + section("function saveDraft()", "/* ── Navigation")
      + section("function setRequestScopeValue(", "function currentNoteLines(")
      + section("async function loadAccount()", "/* ── Wiring"),context);
    return {state,values,responses,calls,el,run:code=>vm.runInContext(code,context)};
  }
  const same=harness(storedDraft());
  same.run("restoreDraft()");
  assert.equal(same.state.draft.tasks.length,0,"Private draft restored before authenticated ownership");
  assert.equal(await same.run("openAuthenticatedJourney()"),true);
  assert.equal(same.state.draft.tasks[0],"Kitchen: private synthetic task");
  same.run("saveDraft()");
  assert.equal(JSON.parse(same.values.get("homle_journey_draft")).ownerId,A);
  assert.equal(same.state.step,"results");

  for(const stored of [storedDraft(A),storedDraft(undefined),{...storedDraft(A),ownerId:undefined},
    storedDraft(B,1800001),"{corrupt", {...storedDraft(B),expiresAt:Date.now()+3600000}]) {
    const other=harness(stored,B);
    await other.run("openAuthenticatedJourney()");
    assert.equal(other.state.draft.tasks.length,0);
    assert.equal(other.state.draft.transcript,"");
    assert(!String(other.values.get("homle_journey_draft")).includes("Private synthetic"));
  }
  const failed=harness(storedDraft());
  failed.responses.failure=true;
  assert.equal(await failed.run("openAuthenticatedJourney()"),false);
  assert.equal(failed.state.draft.tasks.length,0);
  assert.equal(failed.el.journeyShell[0].hidden,true);

  same.state.scanPhotos=[{url:"synthetic-private-photo"}];
  same.state.scanRooms=[{name:"Private room"}];
  same.responses.owner=B;
  let wrote=false;
  await assert.rejects(async()=>{await same.run("recoverCsrf()");wrote=true;},/account changed/);
  assert.equal(wrote,false,"Mutation continued with a different account");
  assert.equal(same.state.scanPhotos.length,0);
  assert.equal(same.state.scanRooms.length,0);
  assert.equal(same.state.draft.tasks.length,0);
  assert.equal(same.values.has("homle_journey_draft"),false);
  assert.equal(same.el.journeyShell[0].hidden,true);
  assert.equal(await same.run("openAuthenticatedJourney()"),true);
  assert.equal(same.state.draftOwner,B);
  const legacy=harness(null,A);
  legacy.values.set("homle_scan_result",JSON.stringify({tasks:["Private prior scan"],transcript:"Private prior scan"}));
  await legacy.run("openAuthenticatedJourney()");
  assert.equal(legacy.state.draft.tasks.length,0);
  assert.equal(legacy.values.has("homle_scan_result"),false);
}
console.log("Actual journey owner recovery passed: pre-auth isolation, same owner, changed owner, legacy/expired/corrupt data, session failure, pending mutation and scan handoff.");

{
  const {reviewedScanNotes} = await import("../public/scan-premium-selection.js");
  const room = {name:"Kitchen",note:"Clean the oven"};
  const state = {draftOwner:"synthetic-owner",step:"results",scanRooms:[room],
    scanNoteEdits:{kitchen:"Leave the oven alone"},scanGeneralNote:"",
    scanPhotos:[{dataUrl:"private-image-must-stay-in-memory"}],
    draft:{transcript:"Kitchen: Clean the oven",rooms:[room],tasks:["Kitchen: Clean the sink"],scanChecklistEdited:true}};
  const values = new Map();
  const storage = {setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const start = journey.indexOf("function saveDraft()");
  const end = journey.indexOf("function restoreDraft()",start);
  const run = new Function("state","sessionStorage","draftKey","landlordRequestDraftLifetimeMs","currentReviewedNotes",
    journey.slice(start,end)+";return saveDraft;");
  const save = run(state,storage,"draft",landlordRequestDraftLifetimeMs,
    ()=>reviewedScanNotes(state.scanRooms,state.scanNoteEdits,state.scanGeneralNote));
  save();
  const saved = JSON.parse(values.get("draft"));
  assert.equal(saved.draft.transcript,"Kitchen: Leave the oven alone");
  assert.equal(saved.draft.rooms[0].note,"Leave the oven alone");
  assert.equal(saved.draft.scanChecklistEdited,true);
  assert.equal(saved.expiresAt-saved.savedAt,landlordRequestDraftLifetimeMs);
  assert.ok(!values.get("draft").includes("private-image"));
  assert.equal(state.draft.transcript,"Kitchen: Clean the oven","Saving mutated the original scan input.");
  state.scanNoteEdits.kitchen="";
  save();
  assert.equal(JSON.parse(values.get("draft")).draft.transcript,"");
  assert.equal(JSON.parse(values.get("draft")).draft.rooms[0].note,"");
  state.scanNoteEdits.kitchen="x".repeat(1001);
  save();
  assert.equal(values.has("draft"),false,"Invalid current notes left stale instructions in recovery.");
  assert.equal(state.scanNoteEdits.kitchen.length,1001,"Invalid draft save discarded editable in-memory instructions.");
}

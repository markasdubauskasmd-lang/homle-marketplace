import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { launchBrowser, resolveChromiumPath, serveStatic } from "../tools/browser-harness.mjs";
import { removeRoom, walkingReadingItems, mergeInventoryIntoSavedDetections } from "../public/room-scan-model.js";

const failures = [];
async function check(name, action) {
  try { await action(); } catch (error) { failures.push(`${name}: ${error.message}`); }
}

// Run the actual deletion handler and detection filters. Deleting a room drops
// its correction history, but retains its paid-read budget and cancellation
// generation. Another room's explicit corrections must remain untouched.
await check("removed room can detect previously dismissed appliances again", () => {
  const source = readFileSync(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8");
  const start = source.indexOf("function confirmDiscardDecision()");
  const body = source.slice(start, source.indexOf("function requestClose()", start));
  const budget = { generation: 2, capturedCount: 3, completedCount: 2, completedSignatures: ["old"] };
  const bathroomDismissed = new Set(["shower"]);
  const state = {
    rooms: [{ name: "Kitchen" }, { name: "Bathroom" }], currentRoom: "Kitchen",
    roomTranscripts: new Map(), inventories: new Map(), walkEvidence: new Map(), walkingPreviews: new Map(),
    keyframeBudgets: new Map([["kitchen", budget]]),
    dismissed: new Map([["kitchen", new Set(["oven"])], ["bathroom", bathroomDismissed]])
  };
  const context = vm.createContext({ state, discardMode: "room", discardRoomName: "Kitchen", removeRoom,
    transcriptKey: name => name.toLowerCase(), rememberRoomNotes() {}, hideDiscard() {}, renderHub() {},
    el: { hubOther: { focus() {} } }, toast() {} });
  vm.runInContext(body, context);
  context.confirmDiscardDecision();
  const reading = { detections: [{ label: "Oven", inventoryKey: "oven", quantity: 1, condition: "medium" }] };
  assert.equal(walkingReadingItems(reading, "Kitchen", state.dismissed.get("kitchen")).length, 1);
  assert.equal(mergeInventoryIntoSavedDetections(reading.detections, [], state.dismissed.get("kitchen")).length, 1);
  assert.equal(state.dismissed.get("bathroom"), bathroomDismissed);
  assert.equal(state.rooms.length, 1);
  assert.equal(state.rooms[0].name, "Bathroom");
  assert.equal(state.keyframeBudgets.get("kitchen"), budget);
  assert.equal(budget.capturedCount, 3);
  assert.equal(budget.generation, 3);
  assert.equal(budget.completedCount, 0);
});

if (!resolveChromiumPath()) {
  if (process.env.CI) throw new Error("Scanner item-editor regression requires Chromium.");
  console.log("Browser item-editor checks skipped: Chromium unavailable.");
} else {
  const server = await serveStatic({ extraFiles: {
    "/editor-proof.html": `<!doctype html><html><head><link rel="stylesheet" href="/styles.css"></head><body>
      <script type="module">import {openRoomScan} from "/room-scan-overlay.js"; window.openScan = openRoomScan;</script></body></html>`
  } });
  const browser = await launchBrowser();
  try {
    for (const width of [390, 1280]) {
      await check(`valid name can be saved after whitespace error at ${width}px`, async () => {
        await browser.setViewport({ width, height: 844, mobile: width === 390 });
        await browser.goto(`${server.origin}/editor-proof.html`);
        const result = await browser.evaluate(`
          const deadline = Date.now() + 8000;
          while (!window.openScan) {
            if (Date.now() > deadline) throw Error('Scanner failed to load');
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          window.openScan({initialRoom: 'Kitchen'});
          document.querySelector('[data-consent-decline]').click();
          document.querySelector('[data-add-inventory]').click();
          const input = document.querySelector('[data-item-editor-name]');
          const form = document.querySelector('[data-item-editor-form]');
          input.value = '   '; form.requestSubmit();
          const whitespaceRejected = Boolean(input.validationMessage);
          input.value = 'Oven'; input.dispatchEvent(new Event('input', {bubbles:true}));
          form.requestSubmit();
          const savedAfterCorrection = document.querySelector('[data-item-editor]').hidden;
          if (!savedAfterCorrection) document.querySelector('[data-item-editor-cancel]').click();
          document.querySelector('[data-add-inventory]').click();
          input.value = '   '; form.requestSubmit();
          document.querySelector('[data-item-editor-cancel]').click();
          document.querySelector('[data-add-inventory]').click();
          const errorAfterReopen = input.validity.customError;
          input.value = 'Fridge'; input.dispatchEvent(new Event('input', {bubbles:true}));
          form.requestSubmit();
          return {whitespaceRejected, savedAfterCorrection, errorAfterReopen,
            savedAfterReopen: document.querySelector('[data-item-editor]').hidden,
            items: [...document.querySelectorAll('[data-inventory-rename]')].map(node => node.textContent)};
        `);
        assert.equal(result.whitespaceRejected, true);
        assert.equal(result.savedAfterCorrection, true, "valid correction is blocked before the submit handler runs");
        assert.equal(result.errorAfterReopen, false, "a previous item's validation error survives reopening");
        assert.equal(result.savedAfterReopen, true);
        assert(result.items.some(label => label.includes("Oven")));
        assert(result.items.some(label => label.includes("Fridge")));
      });
    }
    assert.equal(browser.pageErrors.length, 0, browser.pageErrors.join(" | "));
  } finally { await browser.close(); await server.close(); }
}

assert.deepEqual(failures, []);
console.log("Scanner item-editor recovery and deleted-room correction lifecycle passed (synthetic Chromium 390/1280; not a physical-device trial).");

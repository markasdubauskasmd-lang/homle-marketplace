import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { launchBrowser, resolveChromiumPath, serveStatic } from "../tools/browser-harness.mjs";

const journey = await readFile(new URL("../public/landlord-journey.js", import.meta.url), "utf8");
let launch;
const opener = { disabled: false, focus() { this.focused = true; }, addEventListener(_name, callback) { launch = callback; } };
const ctx = vm.createContext({ el: { scanLink: opener }, state: { step: "service", draft: {} },
  readCurrentStep() {}, canLeaveStep: () => true, openRoomScan: async () => null });
vm.runInContext(journey.slice(journey.indexOf('el.scanLink.addEventListener("click"'), journey.indexOf('el.skipScan.addEventListener("click"')), ctx);
await launch();
assert.equal(opener.disabled, false);
assert.equal(opener.focused, true, "Cancellation did not focus the re-enabled opener");

const overlaySource = await readFile(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8");
assert(overlaySource.includes('containScannerFocus(overlay, () =>'));
assert(overlaySource.includes('[el.discard, el.itemEditor, el.consent, el.hub]'));
assert(overlaySource.indexOf("releaseFocus();") < overlaySource.indexOf("overlay.remove();"));

if (!resolveChromiumPath()) {
  if (process.env.CI) throw new Error("Scanner focus requires Chromium in CI.");
  console.log("Scanner modal browser test skipped without Chromium.");
  process.exit(0);
}
const fixture = `<!doctype html><meta name="viewport" content="width=device-width">
<button id="opener">Open scanner</button><div id="already" inert="existing"><button>Unavailable</button></div>
<div id="scan" role="dialog" aria-modal="true">
  <button id="behind">Behind the room picker</button>
  <section id="room"><button id="first">Kitchen</button><button disabled>Disabled</button><button hidden>Hidden</button><input id="name"><button id="last">Add</button></section>
  <section id="consent" hidden><button id="yes">Allow</button><button id="no">Decline</button></section>
  <section id="discard" hidden><button id="keep">Keep scanning</button><button id="leave">Discard</button></section>
  <section id="empty" hidden></section>
</div>
<script type="module">
import { containScannerFocus } from "/scanner-modal-focus.js";
const scan = document.getElementById("scan");
window.mount = () => window.release = containScannerFocus(scan, () =>
  ["discard", "consent", "empty", "room"].map(id => document.getElementById(id)).find(e => !e.hidden) || scan);
window.mount();
window.ready = true;
</script>`;
const server = await serveStatic({ extraFiles: { "/scanner-focus-fixture": fixture } });
const browser = await launchBrowser();
try {
  for (const width of [390, 1280]) {
    await browser.setViewport({ width, height: 844, mobile: width === 390 });
    await browser.goto(server.origin + "/scanner-focus-fixture");
    assert(await browser.evaluate("return window.ready === true;"));
    assert(await browser.evaluate('return document.getElementById("opener").inert;'));
    async function key(id, shift = false) {
      return browser.evaluate(`
        document.getElementById(${JSON.stringify(id)}).focus();
        const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: ${shift}, bubbles: true, cancelable: true });
        document.activeElement.dispatchEvent(event);
        return { id: document.activeElement.id, prevented: event.defaultPrevented };`);
    }
    assert.deepEqual(await key("last"), { id: "first", prevented: true });
    assert.deepEqual(await key("first", true), { id: "last", prevented: true });
    assert.deepEqual(await key("name"), { id: "name", prevented: false }, "Ordinary Tab was intercepted");
    assert.equal(await browser.evaluate('document.getElementById("behind").focus(); return document.activeElement.id;'), "first");
    const consent = await browser.evaluate(`
      document.getElementById("consent").hidden = false;
      await new Promise(r => setTimeout(r, 0));
      return document.activeElement.id;`);
    assert.equal(consent, "yes", "A new modal layer left focus behind");
    assert.deepEqual(await key("no"), { id: "yes", prevented: true });
    assert.deepEqual(await key("yes", true), { id: "no", prevented: true });
    assert.equal(await browser.evaluate(`
      document.getElementById("discard").hidden = false;
      await new Promise(r => setTimeout(r, 0));
      return document.activeElement.id;`), "keep");
    assert.deepEqual(await key("leave"), { id: "keep", prevented: true });
    assert.equal(await browser.evaluate(`
      document.getElementById("discard").hidden = true;
      await new Promise(r => setTimeout(r, 0));
      return document.activeElement.id;`), "yes");
    assert.equal(await browser.evaluate(`
      document.getElementById("consent").hidden = true;
      document.getElementById("empty").hidden = false;
      await new Promise(r => setTimeout(r, 0));
      return document.activeElement.id;`), "empty");
    assert.deepEqual(await key("empty"), { id: "empty", prevented: true });
    const restored = await browser.evaluate(`
      const late = document.createElement("button"); late.id = "late"; document.body.append(late);
      await new Promise(r => setTimeout(r, 0));
      const lateLocked = late.inert;
      window.release();
      const emptyTab = document.getElementById("empty").getAttribute("tabindex");
      document.getElementById("opener").focus();
      return { lateLocked, lateInert: late.inert, openerInert: document.getElementById("opener").inert,
        existing: document.getElementById("already").getAttribute("inert"), emptyTab, focused: document.activeElement.id };`);
    assert.deepEqual(restored, { lateLocked: true, lateInert: false, openerInert: false, existing: "existing", emptyTab: null, focused: "opener" });
    assert(await browser.evaluate('window.mount(); const locked = document.getElementById("opener").inert; window.release(); return locked && !document.getElementById("opener").inert;'));
  }
  assert.deepEqual(browser.pageErrors, []);
} finally { await browser.close(); await server.close(); }
console.log("Scanner focus passed at 390/1280: Tab wrap, active layers, disabled/hidden controls, dynamic background inertness, restoration, reopen and actual cancellation opener focus.");

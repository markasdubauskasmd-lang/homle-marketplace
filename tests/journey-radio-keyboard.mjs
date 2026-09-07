import assert from "node:assert/strict";
import { launchBrowser, resolveChromiumPath, serveStatic } from "../tools/browser-harness.mjs";

if (!resolveChromiumPath()) {
  if (process.env.CI) throw new Error("Radio keyboard checks require Chromium in CI.");
  console.log("Radio keyboard browser checks skipped without Chromium.");
  process.exit(0);
}
const fixture = `<!doctype html><meta name="viewport" content="width=device-width">
<div id="plain" role="radiogroup" aria-label="Plain choices"></div>
<div id="redraw" role="radiogroup" aria-label="Redrawn choices"></div>
<div id="disabled" role="radiogroup" aria-label="Disabled choices"></div>
<script type="module">
import { bindJourneyRadioGroups } from "/journey-radio-keyboard.js";
window.selectionCounts = { plain: 0, redraw: 0, disabled: 0 };
function render(id, selected = -1) {
  const group = document.getElementById(id);
  group.replaceChildren();
  for (let index = 0; index < 3; index++) {
    const radio = document.createElement("button");
    radio.type = "button";
    radio.setAttribute("role", "radio");
    radio.setAttribute("aria-checked", String(index === selected));
    radio.textContent = String(index);
    radio.disabled = id === "disabled" && index === 1;
    radio.addEventListener("click", () => {
      window.selectionCounts[id]++;
      if (id === "redraw") render(id, index);
      else [...group.children].forEach((item, current) => item.setAttribute("aria-checked", String(current === index)));
    });
    group.append(radio);
  }
}
for (const id of ["plain", "redraw", "disabled"]) render(id);
bindJourneyRadioGroups();
bindJourneyRadioGroups(); // Safe to initialize more than once.
window.radioReady = true;
</script>`;
const server = await serveStatic({ extraFiles: { "/radio-keyboard-fixture": fixture } });
const browser = await launchBrowser();
try {
  for (const width of [390, 1280]) {
    await browser.setViewport({ width, height: 844, mobile: width === 390 });
    await browser.goto(server.origin + "/radio-keyboard-fixture");
    assert(await browser.evaluate("return window.radioReady === true;"));
    for (const id of ["plain", "redraw", "disabled"]) {
      const initial = await browser.evaluate('return [...document.getElementById(' + JSON.stringify(id) + ').children].map(r => r.tabIndex);');
      assert.deepEqual(initial, [0, -1, -1]);
    }
    async function key(id, selectedIndex, keyName, modifiers = {}) {
      return browser.evaluate(`
        const group = document.getElementById(${JSON.stringify(id)});
        const radio = group.children[${selectedIndex}];
        radio.focus();
        radio.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(keyName)}, bubbles: true, cancelable: true, ...${JSON.stringify(modifiers)} }));
        await Promise.resolve();
        return {
          checked: [...group.children].findIndex(r => r.getAttribute("aria-checked") === "true"),
          focused: [...group.children].indexOf(document.activeElement),
          tabStops: [...group.children].filter(r => r.tabIndex === 0).length,
          count: window.selectionCounts[${JSON.stringify(id)}]
        };`);
    }
    for (const id of ["plain", "redraw"]) {
      const down = await key(id, 0, "ArrowDown");
      assert.equal(down.checked, 1);
      assert.equal(down.focused, 1);
      assert.equal(down.tabStops, 1);
      assert.equal(down.count, 1, "Duplicate initialization duplicated selection");
      assert.equal((await key(id, 1, "ArrowRight")).checked, 2);
      assert.equal((await key(id, 2, "ArrowDown")).checked, 0);
      assert.equal((await key(id, 0, "ArrowUp")).checked, 2);
      assert.equal((await key(id, 2, "ArrowLeft")).checked, 1);
      assert.equal((await key(id, 1, "Home")).checked, 0);
      const end = await key(id, 0, "End");
      assert.equal(end.checked, 2);
      assert.equal(end.focused, 2);
      assert.equal((await key(id, 2, "ArrowDown", { altKey: true })).checked, 2);
    }
    assert.equal((await key("disabled", 0, "ArrowRight")).checked, 2);
    assert.equal((await key("disabled", 2, "ArrowLeft")).checked, 0);
    const clicked = await browser.evaluate(`
      const group = document.getElementById("redraw");
      group.children[1].click();
      await Promise.resolve();
      return { focused: [...group.children].indexOf(document.activeElement),
        tabs: [...group.children].map(r => r.tabIndex) };`);
    assert.equal(clicked.focused, 1, "Selection redraw lost focus");
    assert.deepEqual(clicked.tabs, [-1, 0, -1]);
    const disabled = await browser.evaluate(`
      const group = document.getElementById("disabled");
      [...group.children].forEach(r => { r.disabled = true; });
      await new Promise(r => setTimeout(r, 0));
      return [...group.children].map(r => r.tabIndex);`);
    assert.deepEqual(disabled, [-1, -1, -1]);
  }
  assert.deepEqual(browser.pageErrors, []);
} finally { await browser.close(); await server.close(); }
console.log("Journey radio keyboard passed at 390/1280: arrows/wrap/Home/End, one tab stop, disabled skipping, redraw focus and duplicate binding.");

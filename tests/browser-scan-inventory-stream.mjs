import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { serveStatic, launchBrowser, resolveChromiumPath } from "../tools/browser-harness.mjs";

// Exercise the production renderer in a real DOM with deterministic streamed
// identities. This proves display timing/state, not model or phone accuracy.
const source = await readFile(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8");
const start = source.indexOf("    function renderInventory() {");
const end = source.indexOf("    // Everything a walking read", start);
assert(start > 0 && end > start);
const render = source.slice(start, end);
const module = `import * as model from '/room-scan-model.js';
const {inventoryConditionCounts,inventoryKey,inventoryPage,inventoryDisplayLabel,conditionNeedsReview,recommendedAction}=model;
const el=Object.fromEntries(['found','foundList','foundCount','foundNoun','foundBusy'].map(name=>[name,document.getElementById(name)]));
const state={currentRoom:'Kitchen',screen:'live',frozen:false,tracks:[],inventoryPages:new Map(),dismissed:new Map(),walkingPreviews:new Map(),keyframeActiveRooms:new Set(['kitchen'])};
let items=[{key:'oven',label:'Oven',quantity:1,condition:'light',conditionConfidence:.9}];
const inventoryFor=()=>items, transcriptKey=()=>state.currentRoom.toLowerCase(), renderScanDebug=()=>{};
${render}
window.scanHarness={state,draw:renderInventory,getItems:()=>items,setItems:value=>{items=value;renderInventory();},preview:labels=>{state.walkingPreviews.set(transcriptKey(),labels.map((label,index)=>({label,index})));renderInventory();}};
renderInventory();`;
if (!resolveChromiumPath()) { console.log("Browser inventory stream SKIPPED: Chromium unavailable."); }
else {
  const server = await serveStatic({extraFiles:{
    "/stream-test.js":module,
    "/stream-test.html":`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/room-reading-stream.css"><title>Synthetic scanner progress review</title><body style="background:#17202b"><div class="found" id="found"><p class="found-head"><span id="foundCount"></span><span id="foundNoun"></span><span id="foundBusy" class="found-busy"></span></p><ul class="found-list" id="foundList" aria-live="polite"></ul></div><script type="module" src="/stream-test.js"></script>`
  }});
  const browser = await launchBrowser();
  const captures = new URL("../test-artifacts/scanner-stream/", import.meta.url);
  await mkdir(captures,{recursive:true});
  try {
    for (const width of [390,1280]) {
      await browser.setViewport({width,height:844,mobile:width===390});
      await browser.goto(server.origin+"/stream-test.html");
      const until=Date.now()+10000;
      while(!await browser.evaluate("Boolean(window.scanHarness)")) {
        if(Date.now()>until)throw Error("Scanner renderer did not initialize");
        await new Promise(resolve=>setTimeout(resolve,40));
      }
      const checks=await browser.evaluate(`
        const h=scanHarness, before=JSON.stringify(h.getItems());
        h.state.dismissed.set('kitchen',new Set(['fridge']));
        document.querySelector('[data-inventory-rename="oven"]').focus();
        h.preview(['Oven','Air fryer','Air-fryer','Microwave oven','Fridge']);
        const labels=[...document.querySelectorAll('.is-provisional .found-name')].map(el=>el.firstChild.textContent);
        const unchanged=JSON.stringify(h.getItems())===before;
        const editable=Boolean(document.querySelector('[data-inventory-rename="oven"]')) && Boolean(document.querySelector('[data-inventory-remove="oven"]'));
        const heading=document.getElementById('foundNoun').textContent;
        const overflow=document.documentElement.scrollWidth>innerWidth;
        const focused=document.activeElement?.dataset.inventoryRename==='oven';
        return {labels,unchanged,editable,heading,overflow,focused};
      `);
      assert.deepEqual(checks.labels,['Air fryer','Microwave oven']);
      assert(checks.unchanged && checks.editable,'Provisional names changed saved inventory or removed correction controls');
      assert.match(checks.heading,/2 provisional/);assert(!checks.overflow);
      assert(checks.focused,'Streaming discarded keyboard focus from the saved item');
      await writeFile(new URL(`inventory-${width}.png`,captures),await browser.screenshot());
      assert(await browser.evaluate(`
        const h=scanHarness;h.state.frozen=true;h.draw();const frozen=!document.querySelector('.is-provisional');
        h.state.frozen=false;h.state.currentRoom='Bedroom';h.draw();const switched=!document.querySelector('.is-provisional');
        h.state.currentRoom='Kitchen';h.state.keyframeActiveRooms.clear();h.draw();const failed=!document.querySelector('.is-provisional');
        h.state.keyframeActiveRooms.add('kitchen');h.state.walkingPreviews.clear();h.setItems([{key:'oven',label:'Oven'},{key:'air fryer',label:'Air fryer'}]);
        return frozen && switched && failed && !document.querySelector('.is-provisional') && document.querySelectorAll('[data-inventory-rename]').length===2;
      `),'Stale provisional names survived freeze, room switch, failure or final result');
    }
    console.log("Browser inventory stream passed: later-view names appear before completion, saved controls remain, aliases/dismissals filtered, stale results cleared; 390/1280px.");
  } finally {await browser.close();await server.close();}
}

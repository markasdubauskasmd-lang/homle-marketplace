import assert from "node:assert/strict";
import {readFile, mkdir, writeFile} from "node:fs/promises";
import {launchBrowser, resolveChromiumPath, serveStatic} from "../tools/browser-harness.mjs";
import {defaultPricingConfig} from "../public/pricing-config.js";
if (!resolveChromiumPath()) { if (process.env.CI) throw new Error("Scan review browser check requires Chromium."); process.exit(0); }
const owner="11111111-1111-4111-8111-111111111111";
const account={userId:owner,roles:["landlord"],selectedRole:"landlord",displayName:"Synthetic scanner reviewer"};
const writes=[];
const unavailable={status:503,body:{error:"Synthetic unavailable assessment; editing must remain available"}};
let nextPreviewGate;
const previewGates=[];
function holdNextPreview() {
  let receive,release;
  const arrived=new Promise(resolve=>{receive=resolve;});
  const reply=new Promise(resolve=>{release=resolve;});
  const gate={arrived,receive,reply,release};
  nextPreviewGate=gate;previewGates.push(gate);return gate;
}
async function arrivedWithin(promise) {
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("Delayed preview request never arrived")),12000);})]);}
  finally{clearTimeout(timer);}
}
const server=await serveStatic({extraFiles:{
  "/review-seed":"<!doctype html><title>Synthetic review storage setup</title>",
  "/landlord/book":await readFile(new URL("../public/landlord-journey.html",import.meta.url),"utf8"),
  "/api/marketplace/account":()=>({body:{ok:true,account}}),
  "/api/marketplace/properties":()=>({body:{ok:true,properties:[{propertyId:owner,propertyType:"house",exactAddress:{line1:"Synthetic property",city:"London",postcode:"SW1A 1AA"}}]}}),
  "/api/marketplace/auth/session":()=>({body:{ok:true,account,csrfToken:"synthetic-csrf"}}),
  "/api/marketplace/pricing/config":()=>({body:{ok:true,config:defaultPricingConfig}}),
  "/api/marketplace/landlord/scan-preview":async({body})=>{const gate=nextPreviewGate;nextPreviewGate=null;if(!gate)return unavailable;gate.receive(JSON.parse(body));return gate.reply;},
  "/api/health":JSON.stringify({ok:true,marketplace:{ready:true,matchingReady:false,mediaReady:false}}),
  "/api/marketplace/cleaning-requests":({method})=>{writes.push(method);return {status:503,body:{error:"No booking writes allowed"}};}
}});
const browser=await launchBrowser();
const captureRoot=new URL("../test-artifacts/scanner-review-edits/",import.meta.url);
await mkdir(captureRoot,{recursive:true});
async function waitFor(code) {const until=Date.now()+12000;while(!await browser.evaluate(code)){if(Date.now()>until)throw Error("Not ready: "+code+" "+await browser.evaluate("document.body.innerText"));await new Promise(resolve=>setTimeout(resolve,50));}}
async function change(label,value,event="change") {await browser.evaluate(`const field=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']'); if(!field)throw Error('Missing control '+${JSON.stringify(label)}); field.value=${JSON.stringify(value)};field.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));return true;`);}
const saved=()=>browser.evaluate('return JSON.parse(sessionStorage.getItem("homle_journey_draft"))?.draft;');
const ready=()=>waitFor(`document.querySelector('[data-access-gate]')?.hidden && document.querySelector('[data-step=results]')?.hidden===false && document.querySelector('[aria-label="Quantity of Oven"]')`);
try {
 for(const width of [390,1280]) {
  await browser.setViewport({width,height:844,mobile:width===390});
  await browser.goto(server.origin+"/review-seed");
  const object=(inventoryKey,label)=>({inventoryKey,pricingCode:inventoryKey,label,quantity:1,condition:"light",confidenceCondition:.9,confidenceLabel:.95,origin:"vision",soiling:[]});
  const rooms=[{name:"Kitchen",roomType:"kitchen",note:"Leave the keys alone",objects:[object("oven","Oven"),object("tap","Tap"),object("microwave","Microwave")],
    tasks:["Clean the oven","Wipe the tap","Wipe the microwave"],taskRecords:[{text:"Clean the oven",origin:"vision",inventoryKeys:["oven"]},{text:"Wipe the tap",origin:"vision",inventoryKeys:["tap"]},{text:"Wipe the microwave",origin:"vision",inventoryKeys:["microwave"]}]},
    {name:"Pantry",roomType:"other",note:"",objects:[],tasks:[],taskRecords:[]}];
  const draft={propertyId:owner,durationMinutes:120,serviceCode:"regular-domestic",rooms,scanChecklistEdited:false,
    tasks:["Kitchen: Clean the oven","Kitchen: Wipe the tap","Kitchen: Wipe the microwave"],scanPremiumSelected:[JSON.stringify(["kitchen","oven"])],transcript:""};
  await browser.evaluate(`sessionStorage.clear();const now=Date.now();sessionStorage.setItem('homle_journey_draft',JSON.stringify({ownerId:${JSON.stringify(owner)},savedAt:now,expiresAt:now+1800000,step:'results',draft:${JSON.stringify(draft)}}));return true;`);
  await browser.goto(server.origin+"/landlord/book");await ready();
  await change("Room name for Kitchen","Utility");
  await waitFor(`document.querySelector('[aria-label="Room name for Utility"]')`);
  assert((await saved()).scanPremiumSelected.includes(JSON.stringify(["utility","oven"])),"Room rename lost selected oven consent");
  await change("Quantity of Oven","2");
  await browser.evaluate('const note=document.querySelector("#reviewed-room-note-0");note.value="Leave the keys and locked cupboard alone";note.dispatchEvent(new Event("input",{bubbles:true}));return true;');
  await waitFor(`document.querySelector('[data-review-status-message]')?.textContent.includes('unavailable')`);
  await browser.evaluate(`const room=document.querySelector('[aria-label="Room name for Utility"]').closest('section');[...room.querySelectorAll('button')].find(button=>button.textContent==='Add missing item').click();const input=document.querySelector('[aria-label="Missing item name"]');input.value='Air fryer';input.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelector('[data-scan-inline-editor]').querySelectorAll('button')].find(button=>button.textContent==='Save').click();return true;`);
  await waitFor(`document.querySelector('[aria-label="Quantity of Air fryer"]')`);
  await change("Room for Oven","Pantry");
  assert((await saved()).scanPremiumSelected.includes(JSON.stringify(["pantry","oven"])),"Room move lost selected oven consent");
  await browser.evaluate(`const item=document.querySelector('[aria-label="Quantity of Microwave"]').closest('.scan-review-object');[...item.querySelectorAll('button')].find(button=>button.textContent==='Not here').click();return true;`);
  const verify=async()=>{
    const stored=await saved(),utility=stored.rooms.find(room=>room.name==="Utility"),pantry=stored.rooms.find(room=>room.name==="Pantry");
    assert.equal(pantry.objects.find(item=>item.inventoryKey==="oven").quantity,2);
    assert(!utility.objects.some(item=>["oven","microwave"].includes(item.inventoryKey)));
    assert(utility.objects.some(item=>item.label==="Air fryer"));
    assert.equal(utility.note,"Leave the keys and locked cupboard alone");
    assert(utility.removedInventoryKeys.includes("microwave"));
    assert(stored.scanPremiumSelected.includes(JSON.stringify(["pantry","oven"])));
    const tasks=await browser.evaluate('return document.querySelector("[data-tasks]").value;');
    assert(!/microwave/i.test(tasks),"Removed microwave returned to editable checklist");
    assert.match(tasks,/air fryer/i);assert.match(tasks,/locked cupboard/i);
    assert.equal(await browser.evaluate(`return document.querySelector('[aria-label="Quantity of Oven"]').value;`),"2");
    assert.equal(await browser.evaluate(`return document.querySelector('[aria-label="Room for Oven"]').value;`),"Pantry");
    assert.equal(await browser.evaluate(`return !!document.querySelector('[aria-label="Quantity of Microwave"]');`),false);
    assert.equal(await browser.evaluate('return document.documentElement.scrollWidth<=innerWidth+1;'),true,"Review overflows viewport");
  };
  await verify();
  await browser.goto(server.origin+"/landlord/book");await ready();await verify();
  await browser.evaluate('document.querySelector("[data-back]").click();return true;');
  await waitFor('document.querySelector("[data-step=service]")?.hidden===false');
  await browser.goto(server.origin+"/landlord/book");
  await waitFor('document.querySelector("[data-access-gate]")?.hidden && document.querySelector("[data-step=service]")?.hidden===false');
  await browser.evaluate('document.querySelector("[data-skip-scan]").click();return true;');await ready();await verify();
  // Resolve a real in-flight request while an editor has unsaved text. Release
  // is explicit, so neither network speed nor a fixed sleep decides the race.
  for(const outcome of ["failure","success"]) {
    await waitFor(`document.querySelector('[data-review-status-message]')?.textContent.includes('unavailable')`);
    const gate=holdNextPreview();
    await browser.evaluate('document.querySelector("[data-review-retry]").click();return true;');
    const request=await arrivedWithin(gate.arrived);
    const label=outcome==="failure"?"Radiator":"Rug";
    await browser.evaluate(`const room=document.querySelector('[aria-label="Room name for Utility"]').closest('section');[...room.querySelectorAll('button')].find(button=>button.textContent==='Add missing item').click();const input=document.querySelector('[aria-label="Missing item name"]');window.__pendingScanEditor=input;input.value=${JSON.stringify(label)};input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();return true;`);
    gate.release(outcome==="failure"?unavailable:{body:{ok:true,scan:{rooms:request.rooms,complexity:{assessed:true,level:1,levelLabel:"Synthetic assessment",explanation:"Synthetic delayed response",questions:[]}}}});
    await waitFor(outcome==="failure"?`document.querySelector('[data-review-status-message]')?.textContent.includes('unavailable')`:`document.querySelector('[data-review-status]')?.hidden===true`);
    const retained=await browser.evaluate(`return {connected:window.__pendingScanEditor.isConnected,value:window.__pendingScanEditor.value,focused:document.activeElement===window.__pendingScanEditor};`);
    assert.equal(retained.connected,true,`${outcome} assessment removed the open item editor`);
    assert.equal(retained.value,label,`${outcome} assessment erased unsaved item text`);
    assert.equal(retained.focused,true,`${outcome} assessment stole editor focus`);
    await browser.evaluate(`const editor=window.__pendingScanEditor.closest('[data-scan-inline-editor]');[...editor.querySelectorAll('button')].find(button=>button.textContent==='Save').click();return true;`);
    await waitFor(`document.querySelector('[aria-label="Quantity of ${label}"]') && !document.querySelector('[data-scan-inline-editor]')`);
    assert((await saved()).rooms.find(room=>room.name==="Utility").objects.some(item=>item.label===label));
  }
  await waitFor(`document.querySelector('[data-review-status-message]')?.textContent.includes('unavailable')`);
  const nameGate=holdNextPreview();
  await browser.evaluate('document.querySelector("[data-review-retry]").click();return true;');
  await arrivedWithin(nameGate.arrived);
  await browser.evaluate(`const input=document.querySelector('[aria-label="Room name for Utility"]');window.__pendingRoomName=input;input.focus();input.value='Utility room';input.dispatchEvent(new Event('input',{bubbles:true}));return true;`);
  nameGate.release(unavailable);
  await waitFor(`document.querySelector('[data-review-status-message]')?.textContent.includes('unavailable')`);
  assert.equal(await browser.evaluate(`return window.__pendingRoomName.isConnected && document.activeElement===window.__pendingRoomName && window.__pendingRoomName.value==='Utility room';`),true,"Assessment erased a focused unfinished room rename");
  await browser.evaluate(`window.__pendingRoomName.dispatchEvent(new Event('change',{bubbles:true}));return true;`);
  await waitFor(`document.querySelector('[aria-label="Room name for Utility room"]')`);
  assert.equal((await saved()).rooms.find(room=>room.name==="Utility room").note,"Leave the keys and locked cupboard alone");
  await waitFor(`document.querySelector('[data-review-status-message]')?.textContent.includes('unavailable')`);
  await browser.evaluate(`await Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const room=document.querySelector('[aria-label="Room name for Utility room"]').closest('section');room.scrollIntoView({behavior:'instant',block:'start'});window.scrollBy({top:-90,behavior:'instant'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true;`);
  assert.equal(await browser.evaluate(`const control=document.querySelector('[aria-label="Room name for Utility room"]');const rect=control.getBoundingClientRect();return rect.top>=0 && rect.bottom<innerHeight && getComputedStyle(document.querySelector('[data-step=results]')).opacity==='1';`),true,"Capture must show settled room editing controls");
  await writeFile(new URL("review-"+width+".png",captureRoot),await browser.screenshot());
  // Use actual controls, then reload the saved draft before another AI view.
  await browser.evaluate(`const row=document.querySelector('[aria-label="Quantity of Tap"]').closest('.scan-review-object');[...row.querySelectorAll('button')].find(button=>button.textContent==='Rename').click();const input=document.querySelector('[aria-label="Item name"]');input.value='Towel rail';[...document.querySelector('[data-scan-inline-editor]').querySelectorAll('button')].find(button=>button.textContent==='Save').click();return true;`);
  await waitFor(`document.querySelector('[aria-label="Quantity of Towel rail"]')`);
  await browser.evaluate(`const row=document.querySelector('[aria-label="Quantity of Towel rail"]').closest('.scan-review-object');[...row.querySelectorAll('button')].find(button=>button.textContent==='Not here').click();return true;`);
  await browser.goto(server.origin+"/landlord/book");await ready();
  const followthrough=await browser.evaluate(`const {mergeReviewedRoomRescan}=await import('/scan-review-edit.js');const draft=JSON.parse(sessionStorage.getItem('homle_journey_draft')).draft;const room=draft.rooms.find(room=>room.name==='Utility room');const reread=mergeReviewedRoomRescan(room,{objects:[{inventoryKey:'towel rail',label:'Towel rail',quantity:1}],tasks:[]});return {removed:room.removedInventoryKeys,reappeared:reread.objects.some(item=>item.label==='Towel rail'),visible:!!document.querySelector('[aria-label="Quantity of Towel rail"]')};`);
  assert(followthrough.removed.includes('tap') && followthrough.removed.includes('towel rail'));
  assert.equal(followthrough.reappeared,false,"A reread recreated the renamed, removed item after reload");
  assert.equal(followthrough.visible,false);
 }
 assert.deepEqual(writes,[]);
 assert.deepEqual(browser.pageErrors.filter(message=>!/favicon|manifest/i.test(message)),[]);
} finally {for(const gate of previewGates)gate.release(unavailable);await browser.close();await server.close();}
console.log("Browser scan review passed at390/1280: rename, quantity, notes, add, move, remove, consent, reload/back persistence; explicitly delayed success/failure preserve unsaved item edits and focused room names; no booking writes, synthetic APIs only.");

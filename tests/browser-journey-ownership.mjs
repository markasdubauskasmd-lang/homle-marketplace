import { inspectCustomerMotion, assertCustomerMotion } from "./customer-motion-state-helper.mjs";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { launchBrowser, resolveChromiumPath, serveStatic } from "../tools/browser-harness.mjs";
if (!resolveChromiumPath()) { if(process.env.CI) throw new Error("Ownership browser check requires Chromium."); process.exit(0); }
const A="11111111-1111-4111-8111-111111111111", B="22222222-2222-4222-8222-222222222222";
let owner=A, failSession=false;
const writes=[];
const account=()=>({userId:owner,roles:["landlord"],selectedRole:"landlord",displayName:"Synthetic owner"});
const html=await readFile(new URL("../public/landlord-journey.html",import.meta.url),"utf8");
const server=await serveStatic({extraFiles:{
  "/owner-seed":"<!doctype html><title>Synthetic storage setup</title>",
  "/landlord/book":html,
  "/api/marketplace/account":()=>({body:{ok:true,account:account()}}),
  "/api/marketplace/properties":()=>({body:{ok:true,properties:[{propertyId:owner,propertyType:"house",exactAddress:{line1:"Synthetic property",city:"London",postcode:"SW1A 1AA"}}]}}),
  "/api/marketplace/auth/session":({method})=>{assert.equal(method,"POST"); return failSession?{status:503,body:{error:"Synthetic session unavailable"}}:{body:{ok:true,account:account(),csrfToken:"synthetic-csrf"}};},
  "/api/health":JSON.stringify({ok:true,marketplace:{ready:true,matchingReady:false,mediaReady:false}}),
  "/api/marketplace/cleaning-requests":({method})=>{writes.push(method);return {status:503,body:{error:"No real writes"}};}
}});
const browser=await launchBrowser();
const motionRows=[];
const captureRoot = new URL("../test-artifacts/customer-responsive/", import.meta.url);
await mkdir(captureRoot, {recursive:true});
async function waitFor(code) { const end=Date.now()+12000; while(!await browser.evaluate(code)) { if(Date.now()>end)throw new Error("Not ready: "+code+" "+await browser.evaluate("document.body.innerText")); await new Promise(r=>setTimeout(r,50)); } }
async function seed(ownerId=A) {
 await browser.goto(server.origin+"/owner-seed");
 await browser.evaluate(`
 const now=Date.now();
 sessionStorage.setItem("homle_journey_draft",JSON.stringify({ownerId:${JSON.stringify(ownerId)},savedAt:now,expiresAt:now+1800000,step:"results",
 draft:{propertyId:${JSON.stringify(A)},durationMinutes:120,serviceCode:"regular-domestic",tasks:["Kitchen: Private synthetic account A task"],transcript:"Private synthetic account A note"}}));
 return true;`);
}
const results=()=>waitFor('document.querySelector("[data-access-gate]")?.hidden && document.querySelector("[data-step=results]")?.hidden === false');
try {
 for(const width of [390,768,1280,1440]) {
  await browser.setViewport({width,height:width===768?1024:width===1440?900:844,mobile:width===390}); owner=A; failSession=false;
  await seed(); await browser.goto(server.origin+"/landlord/book"); await results();
  motionRows.push(await inspectCustomerMotion(browser, "journey-results " + width));
  assert((await browser.evaluate('document.querySelector("[data-tasks]").value')).includes("Private synthetic"));
  await browser.evaluate('document.querySelector("[data-tasks]").scrollIntoView({block:"center",behavior:"instant"}); return true;');
  await writeFile(new URL("fields-journey-results-"+width+".png",captureRoot),await browser.screenshot());
  await browser.evaluate('document.querySelector("[data-tasks]").value="Kitchen: Private edited account A task"; document.querySelector("[data-back]").click(); return true;');
  await waitFor('document.querySelector("[data-step=service]")?.hidden === false');
  motionRows.push(await inspectCustomerMotion(browser, "journey-service " + width));
  await browser.evaluate('await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return true;');
      await writeFile(new URL("targets-journey-service-"+width+".png",captureRoot),await browser.screenshot());
  await browser.evaluate('window.motionCameraRequests=0; navigator.mediaDevices.getUserMedia=async()=>{window.motionCameraRequests++;throw new DOMException("Camera disabled in motion check","NotAllowedError");}; document.querySelector("[data-scan-link]").click(); return true;');
  await waitFor('document.querySelector(".scan-overlay [data-hub]")?.hidden === false');
  motionRows.push(await inspectCustomerMotion(browser, "scanner-room-picker-camera-denied " + width));
  await browser.evaluate('await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return true;');
      await writeFile(new URL("targets-scanner-room-picker-camera-denied-"+width+".png",captureRoot),await browser.screenshot());
  await browser.evaluate('document.querySelector(".scan-overlay [data-hub] [data-close]").click(); return true;');
  await waitFor('!document.querySelector(".scan-overlay")');
  assert.equal(await browser.evaluate("window.motionCameraRequests"),1,"Expected the initial camera attempt to hit the denying fixture");
  await browser.goto(server.origin+"/landlord/book");
  await waitFor('document.querySelector("[data-access-gate]")?.hidden && document.querySelector("[data-step=service]")?.hidden === false');
  await browser.evaluate('document.querySelector("[data-skip-scan]").click(); return true;'); await results();
  assert((await browser.evaluate('document.querySelector("[data-tasks]").value')).includes("Private edited"));
  owner=B; await browser.goto(server.origin+"/landlord/book");
  await waitFor('document.querySelector("[data-access-gate]")?.hidden && document.querySelector("[data-step=postcode]")?.hidden === false');
  assert.equal(await browser.evaluate('return [...document.querySelectorAll("input,textarea")].some(e=>e.value.includes("Private")) || sessionStorage.getItem("homle_journey_draft")?.includes("Private") || false;'),false);
  motionRows.push(await inspectCustomerMotion(browser, "journey-new-owner-entry " + width));
  owner=A; await seed(); failSession=true; await browser.goto(server.origin+"/landlord/book");
  await waitFor('document.querySelector("[data-access-retry]")?.hidden === false');
  assert.equal(await browser.evaluate('return [...document.querySelectorAll("input,textarea")].some(e=>e.value.includes("Private"));'),false);
  motionRows.push(await inspectCustomerMotion(browser, "journey-session-error " + width));
  failSession=false;
 }
 assert.deepEqual(writes,[]);
 assertCustomerMotion(motionRows);
 assert.deepEqual(browser.pageErrors,[]);
} finally {await browser.close(); await server.close();}
console.log("Browser ownership passed at 390/768/1280/1440: same-owner edit/back/reload, changed owner, failed session; no private request writes.");

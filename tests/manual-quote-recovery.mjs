import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const source=await readFile(new URL("../public/landlord-dashboard.js",import.meta.url),"utf8");
const handler=source.slice(source.indexOf("async function refreshManualQuote("),source.indexOf("function scheduleManualQuote()"));
function harness(recoverCsrf) {
  const context=vm.createContext({
    manualQuote:{hidden:true},manualQuotePrice:{textContent:""},manualQuoteDuration:{textContent:""},manualQuoteStatus:{textContent:""},
    manualQuoteGeneration:1,manualQuoteSignature:"",recoverCsrf,
    requestJson:async()=>({quote:{priceable:true,totalPence:5600,estimatedMinutes:120}}),
    formatQuotedDuration:()=>"2 hours",formatBookingMoney:()=>"£56"
  });
  vm.runInContext(handler,context);return context;
}
const expired=harness(async(status)=>{status.textContent="Sign in again";return "";});
await expired.refreshManualQuote(1,{},"one");
assert.equal(expired.manualQuote.hidden,true);
assert.equal(expired.manualQuoteStatus.textContent,"Sign in again");
const failed=harness(async()=>{throw new Error("Offline");});
await failed.refreshManualQuote(1,{},"one");
assert.equal(failed.manualQuote.hidden,true);
assert.match(failed.manualQuoteStatus.textContent,/Offline/);
let finish;
const stale=harness(()=>new Promise(resolve=>{finish=resolve;}));
const waiting=stale.refreshManualQuote(1,{},"one");
stale.manualQuoteGeneration=2;stale.manualQuotePrice.textContent="New result";
finish("");await waiting;
assert.equal(stale.manualQuote.hidden,false);
assert.equal(stale.manualQuotePrice.textContent,"New result");
const ready=harness(async()=>"test-token");
await ready.refreshManualQuote(1,{},"one");
assert.equal(ready.manualQuote.hidden,false);
assert.equal(ready.manualQuotePrice.textContent,"£56");
console.log("Manual quote recovery passed: failed auth stops loading, thrown failures recover and stale responses preserve the newer result.");

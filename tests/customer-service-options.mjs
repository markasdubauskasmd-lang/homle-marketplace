import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { services, arrivalWindows, isKnownService } from "../public/landlord-journey-model.js";
const html=await readFile(new URL("../public/landlord-dashboard.html",import.meta.url),"utf8");
const select=html.match(/<select name="cleaningType"[^>]*>([\s\S]*?)<\/select>/)[1];
const manual=[...select.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map(match=>({code:match[1],name:match[2]}));
assert.deepEqual(manual.map(x=>x.code).sort(),services.map(x=>x.code).sort());
for(const option of manual){
 assert(isKnownService(option.code));
 assert.equal(services.find(service=>service.code===option.code).name,option.name);
}
const expected=Array.from({length:21},(_,index)=>{const minutes=480+index*30;return String(Math.floor(minutes/60)).padStart(2,"0")+":"+String(minutes%60).padStart(2,"0");});
assert.deepEqual([...arrivalWindows],expected);
console.log("Customer service and timing parity passed: all six supported types and 21 requested start times.");

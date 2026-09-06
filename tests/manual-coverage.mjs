import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { isUkPostcode } from "../public/contact-validation.js";
const source = await readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8");
const coverageSource = source.slice(source.indexOf("const manualCoverage ="), source.indexOf("const mediaReadiness ="));
function harness() {
  const status = { textContent: "" }, retry = { hidden: true }, pending = [];
  const form = { dataset: {} };
  const select = { value: "one" }, service = { value: "regular-domestic" };
  const context = vm.createContext({
    document: { querySelector: selector => selector.includes("-retry") ? retry : status },
    properties: [{ propertyId: "one", exactAddress: { postcode: "SW1A 1AA" } },{propertyId:"two",exactAddress:{postcode:"SM4 4LE"}}],
    propertySelect: select, cleaningTypeSelect: service, requestForm: form,
    isUkPostcode, URLSearchParams,
    requestJson(url, options) { return new Promise((resolve,reject)=>pending.push({url,options,resolve,reject})); }
  });
  vm.runInContext(coverageSource, context);
  return {context,status,retry,pending,form,select,service};
}
{
  const h = harness();
  const first = h.context.checkManualCoverage();
  assert.equal(h.form.dataset.coveragePending, "true");
  assert.equal(h.pending[0].options.timeoutMs, 8000);
  assert(!h.pending[0].url.includes("1AA"), "The full postcode escaped into the directory lookup.");
  h.service.value = "deep-cleans";
  const second = h.context.checkManualCoverage();
  h.pending[0].resolve({cleaners:[{}]}); await first;
  assert.equal(h.form.dataset.coveragePending,"true");
  h.pending[1].resolve({cleaners:[]}); await second;
  assert.match(h.status.textContent,/No profiles for this cleaning type/);
  assert.equal(h.form.dataset.coveragePending,"false");
  assert(h.pending[1].url.includes("serviceCode=deep-cleans"));
}
{
  const h=harness();
  const first=h.context.checkManualCoverage();
  h.select.value="two";
  const second=h.context.checkManualCoverage();
  h.pending[1].resolve({cleaners:[{}]}); await second;
  h.pending[0].reject(new Error("late timeout")); await first;
  assert.match(h.status.textContent,/SM4/);
  assert.doesNotMatch(h.status.textContent,/could not/);
  const third=h.context.checkManualCoverage({force:true});
  h.pending[2].reject(new Error("timeout")); await third;
  assert.match(h.status.textContent,/could not be checked/);
  assert.equal(h.form.dataset.coveragePending,"false");
  assert.equal(h.retry.hidden,false);
}
{
  const h=harness();
  const run=h.context.checkManualCoverage();
  h.pending[0].resolve({error:"not a directory"});await run;
  assert.match(h.status.textContent,/could not be checked/);
  h.select.value="";
  await h.context.checkManualCoverage();
  assert.equal(h.form.dataset.coveragePending,"false");
  assert.match(h.status.textContent,/Choose a property/);
}
const wizard=await readFile(new URL("../public/landlord-prepare-wizard.js",import.meta.url),"utf8");
const goTo=wizard.slice(wizard.indexOf("  function goTo("),wizard.indexOf("  // Validate only"));
{
  const visited=[],validated=[];
  const ctx=vm.createContext({
    current:0,total:5,
    form:{dataset:{coveragePending:"true"},dispatchEvent(){}},Event:class{},
    panel:{querySelector(){return {focus(){visited.push("coverage");}};}},
    render(){},card:null,steps:Array.from({length:5},()=>({focus(){}})),
    validateStep(step){validated.push(step);return step!==1;}
  });
  vm.runInContext(goTo,ctx);
  ctx.goTo(4);
  assert.equal(ctx.current,0);
  assert.deepEqual(visited,["coverage"]);
  ctx.form.dataset.coveragePending="false";
  ctx.goTo(4);
  assert.equal(ctx.current,0);
  assert.deepEqual(validated,[0,1],"A progress dot skipped validation of earlier steps.");
  ctx.current=3;ctx.goTo(1);
  assert.equal(ctx.current,1,"Back navigation was blocked.");
}
console.log("Manual coverage and navigation tests passed: service/property races, bounded error recovery, postcode privacy and forward-step validation.");

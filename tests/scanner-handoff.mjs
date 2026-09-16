import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createPremiumPlan,premiumScope,premiumChoiceId} from '../public/scan-premium-selection.js';
import {scanChecklistLines} from '../public/room-scan-model.js';
import {defaultPricingConfig} from '../public/pricing-config.js';

const source=readFileSync(new URL('../public/landlord-journey.js',import.meta.url),'utf8');
const start=source.indexOf('el.scanLink.addEventListener("click", async () => {');
const end=source.indexOf('el.skipScan.addEventListener',start);
const tick=()=>new Promise(setImmediate);
const result={rooms:[{name:'Kitchen',objects:[{inventoryKey:'oven',label:'Oven',quantity:1}],tasks:['Wipe the oven door']}],tasks:['Kitchen: Wipe the oven door'],photos:[],transcript:''};
function fixture() {
  let handler,releaseScan,releasePricing,pricingCalls=0,saves=0,refreshes=0;
  const state={step:'service',draftOwner:'original-owner',draft:{serviceCode:'regular-domestic',rooms:[],tasks:[]}};
  const scan=new Promise(resolve=>{releaseScan=resolve;});
  const pricing=new Promise(resolve=>{releasePricing=resolve;});
  const context=vm.createContext({state,defaultPricingConfig,pricingConfig:null,createPremiumPlan,
    el:{scanLink:{addEventListener:(_event,fn)=>{handler=fn;},focus(){}}},
    readCurrentStep(){},canLeaveStep:()=>true,openRoomScan:()=>scan,
    loadPricingConfig:async()=>{pricingCalls++;await pricing;context.pricingConfig=defaultPricingConfig;},
    refreshScanReview:()=>{refreshes++;},suggestedDurationMinutes:()=>120,
    setRequestScopeValue:(field,value)=>{state.draft[field]=value;},
    saveDraft:()=>{saves++;},show:step=>{state.step=step;},toast(){}
  });
  vm.runInContext(source.slice(start,end),context);
  return {state,context,run:()=>handler(),releaseScan,releasePricing,get saves(){return saves;},get refreshes(){return refreshes;},get pricingCalls(){return pricingCalls;}};
}

// The real Done listener must expose and persist the result before an unrelated
// pricing request finishes. No timing threshold or fast-network assumption.
{
  const f=fixture();const pending=f.run();f.releaseScan(structuredClone(result));await tick();
  try {
    assert.equal(f.state.step,'results','Done waits for pricing before showing editable scan results');
    assert.equal(f.saves,1,'Completed scan is not saved while pricing is pending');
    assert.equal(f.state.scanRooms[0].objects[0].label,'Oven');
    assert.equal(f.refreshes,1);
  } finally {f.releasePricing();await pending;}
}

for(const change of ['owner','draft']) {
  const f=fixture();const pending=f.run();
  if(change==='owner')f.state.draftOwner='replacement-owner';
  else f.state.draft={serviceCode:'deep-cleans',rooms:[],tasks:['New private draft']};
  const before=JSON.stringify(f.state.draft);
  f.releaseScan(structuredClone(result));f.releasePricing();await pending;
  assert.equal(JSON.stringify(f.state.draft),before,'Late camera result overwrote a different '+change);
  assert.equal(f.saves,0);assert.equal(f.refreshes,0);
}
console.log('Scanner handoff: immediate editable results and account/draft ownership passed.');

// Late rates use the current corrected rooms and preserve explicit specialist
// selections and customer-written checklist lines, never the old captured room.
{
  const rooms=[{name:'Utility',objects:[{inventoryKey:'oven',pricingCode:'oven',label:'Oven',quantity:2}],tasks:['Wipe the oven exterior']}];
  const id=premiumChoiceId('Utility','oven');
  const config={...defaultPricingConfig,premiumItems:{...defaultPricingConfig.premiumItems,oven:{label:'Oven deep clean',pence:6700}}};
  const state={scanPremiumPlan:createPremiumPlan(rooms,scanChecklistLines(rooms),defaultPricingConfig),scanPremiumSelected:[id],draft:{scanChecklistEdited:true}};
  let saved=0,painted=0;
  const context=vm.createContext({state,pricingConfig:config,defaultPricingConfig,createPremiumPlan,premiumScope,scanChecklistLines,
    correctedScanRooms:()=>rooms,taskReviewRooms:()=>rooms,eligiblePremiumSelections:()=>state.scanPremiumSelected,
    editableTaskLines:()=>['Utility: Leave locked cupboards alone'],reconcileReviewedChecklist(){},
    renderPremiumChoices:()=>{painted++;},updateResultTotals(){},saveDraft:()=>{saved++;}});
  const first=source.indexOf('function refreshScanPricing()'),last=source.indexOf('function renderReviewPrice(',first);
  vm.runInContext(source.slice(first,last),context);context.refreshScanPricing();
  assert.equal(state.scanPremiumPlan.options[0].pence,6700);
  assert.equal(state.scanPremiumSelected[0],id);
  assert(state.draft.tasks.includes('Utility: Leave locked cupboards alone'));
  assert(state.draft.tasks.some(line=>line.includes('Oven deep clean')));
  assert.equal(saved,1);assert.equal(painted,1);
  rooms[0].objects=[];context.refreshScanPricing();
  assert.equal(state.scanPremiumPlan.options.length,0);assert.equal(state.scanPremiumSelected.length,0);
  assert.deepEqual(Array.from(state.draft.tasks),['Utility: Leave locked cupboards alone']);
}

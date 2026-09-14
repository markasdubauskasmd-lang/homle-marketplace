// Isolated, loopback-only review fixture. No production account or booking writes.
import {readFile} from "node:fs/promises";
import {serveStatic} from "./browser-harness.mjs";
import {defaultPricingConfig} from "../public/pricing-config.js";
import {normalizedRoomScan,scanProjection} from "../src/marketplace/scan-service.mjs";
const owner="11111111-1111-4111-8111-111111111111";
const account={userId:owner,roles:["landlord"],selectedRole:"landlord",displayName:"Scanner preview"};
const objects=["Oven","Air fryer","Microwave","Cooker","Fridge"].map(label=>({label,inventoryKey:label.toLowerCase(),quantity:1,condition:"",confidenceLabel:.9,confidenceCondition:0,origin:"vision"}));
const rooms=[{name:"Kitchen",roomType:"kitchen",note:"Do not clean inside the oven",objects,fixtures:objects.map(item=>item.label),tasks:["Wipe the worktop"],taskRecords:[{text:"Wipe the worktop",origin:"vision",inventoryKeys:[]}]},{name:"Utility",roomType:"other",objects:[],tasks:[],note:""}];
const draft={propertyId:owner,serviceCode:"regular-domestic",durationMinutes:120,tasks:["Kitchen: Wipe the worktop"],rooms,transcript:"Kitchen: Do not clean inside the oven",scanChecklistEdited:false};
const html=await readFile(new URL("../public/landlord-journey.html",import.meta.url),"utf8");
const server=await serveStatic({port:Number(process.env.PORT||4212),extraFiles:{
  "/":`<!doctype html><meta charset="utf-8"><title>Scanner review preview</title><h1>Scanner review preview</h1><p>Synthetic rooms. No live bookings, payments or AI calls.</p><button id="start">Open editable room review</button><script>document.querySelector('#start').onclick=()=>{const now=Date.now();sessionStorage.setItem('homle_journey_draft',JSON.stringify({ownerId:'${owner}',savedAt:now,expiresAt:now+1800000,step:'results',draft:${JSON.stringify(draft)}}));location.href='/landlord/book';};</script>`,
  "/camera-preview": `<!doctype html><meta charset="utf-8"><title>Synthetic scanner camera</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/customer-scan.css"><body class="journey-page"><h1>Synthetic camera test</h1><p>Generated test scene and fixed detections. No real camera, AI or upload.</p><button id="scan">Open scanner</button><pre id="result"></pre><script type="module">
import {openRoomScan} from '/room-scan-overlay.js';
const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');
function paint(){ctx.fillStyle='#eee';ctx.fillRect(0,0,1280,720);ctx.fillStyle='#888';ctx.fillRect(50,420,1180,220);ctx.fillStyle='#222';ctx.fillRect(100,440,240,180);ctx.fillStyle='#555';ctx.fillRect(750,80,320,500);ctx.fillStyle='white';ctx.font='36px sans-serif';ctx.fillText('Oven',160,550);ctx.fillText('Fridge',825,260);}paint();setInterval(paint,100);
navigator.mediaDevices.getUserMedia=async()=>canvas.captureStream(10);
document.querySelector('#scan').onclick=async()=>{const result=await openRoomScan({initialRoom:'Kitchen',itemOnly:true});document.querySelector('#result').textContent=JSON.stringify(result?.rooms,null,2);};
</script>`.replaceAll('\n+','\n'),
  "/landlord/book":html,
  "/api/marketplace/account":()=>({body:{ok:true,account}}),
  "/api/marketplace/auth/session":()=>({body:{ok:true,account,csrfToken:"synthetic-preview"}}),
  "/api/marketplace/properties":()=>({body:{ok:true,properties:[{propertyId:owner,propertyType:"house",exactAddress:{line1:"Synthetic preview home",city:"London",postcode:"SW1A 1AA"}}]}}),
  "/api/marketplace/pricing/config":()=>({body:{ok:true,config:defaultPricingConfig}}),
  "/api/health":()=>({body:{ok:true,marketplace:{ready:true,matchingReady:false,mediaReady:false}}}),
  "/api/marketplace/landlord/scan-preview":({body})=>process.env.PREVIEW_FAILURE==="1"?{status:503,body:{error:"Synthetic assessment failure"}}:{body:{ok:true,scan:scanProjection({rooms:normalizedRoomScan({...JSON.parse(body),cleaningRequestId:owner}).rooms})}},
  "/api/marketplace/landlord/room-reading":()=>({body:{ok:true,condition:"light",detections:[{id:"oven",label:"Oven",confidence:.9,condition:"unknown",conditionConfidence:0,x:8,y:60,width:22,height:25},{id:"fridge",label:"Fridge",confidence:.9,condition:"unknown",conditionConfidence:0,x:58,y:10,width:28,height:74}],tasks:["Wipe appliance exteriors"],taskLinks:[]}}),
  "/api/marketplace/cleaning-requests":()=>({status:409,body:{error:"This preview cannot create bookings"}})
}});
console.log("Scanner review preview: "+server.origin);

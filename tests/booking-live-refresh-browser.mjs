import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {serveStatic,launchBrowser} from '../tools/browser-harness.mjs';
let account={userId:'11111111-1111-4111-8111-111111111111',displayName:'Demo worker',roles:['cleaner'],selectedRole:'cleaner'};
const start=new Date();start.setHours(14,0,0,0);
let jobs=[];
const job={bookingId:'22222222-2222-4222-8222-222222222222',participantRole:'cleaner',canRespond:true,status:'pending-cleaner-acceptance',propertyArea:'SW1A',latitude:51.5,longitude:-0.14,cleaningType:'DEMO cleaning job',locationLabel:'SW1A',pricePence:6500,pricePerspective:'cleaner-pay',taskCount:3,scheduledStartAt:start.toISOString(),scheduledEndAt:new Date(+start+7200000).toISOString(),responseDeadline:new Date(Date.now()+3600000).toISOString()};
const extraFiles={};for(const [route,file] of [['/cleaner/jobs-map','cleaner-jobs-map.html'],['/cleaner/schedule','cleaner-schedule.html'],['/landlord/dashboard','landlord-dashboard.html']])extraFiles[route]=await readFile('public/'+file,'utf8');
Object.assign(extraFiles,{'/api/marketplace/account':()=>({body:{account}}),'/api/marketplace/bookings':()=>({body:{bookings:jobs}}),'/api/marketplace/cleaner/profile':()=>({body:{profile:{services:[],serviceAreas:[],travelRadiusKm:25}}}),'/api/marketplace/cleaner/onboarding':()=>({body:{sections:[]}}),'/api/marketplace/cleaner/availability':()=>({body:{availability:[]}}),'/api/marketplace/cleaner/onboarding/availability':()=>({body:{section:null}})});
extraFiles['/api/marketplace/landlord/bootstrap']=()=>({body:{account,bookings:jobs,properties:[],cleaningRequests:[],unavailable:[]}});
extraFiles['/api/marketplace/cleaning-requests']=()=>({body:{cleaningRequests:[]}});
extraFiles['/api/health']=()=>({body:{marketplace:{capabilities:{automaticDispatchReady:true}}}});
const server=await serveStatic({extraFiles});const browser=await launchBrowser();
async function waitFor(code){for(let i=0;i<100;i++){if(await browser.evaluate('return '+code))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+code);}
async function wake(){await browser.evaluate("window.dispatchEvent(new Event('focus')); return true;");}
try{
await browser.goto(server.origin+'/cleaner/jobs-map');await waitFor("document.querySelector('[data-workspace-travel]').textContent.includes('Maximum distance:')");jobs=[job];await wake();await waitFor("document.querySelector('[data-map-count]').textContent==='1'");assert.match(await browser.evaluate('return document.body.innerText'),/DEMO cleaning job/);
jobs=[{...job,status:'confirmed'}];await wake();await waitFor("document.querySelector('[data-map-count]').textContent==='0'");
await browser.goto(server.origin+'/cleaner/schedule');await waitFor("document.body.innerText.includes('DEMO cleaning job')");await waitFor("!document.querySelector('[name=holidayMode]').disabled");jobs=[{...job,status:'cancelled',canRespond:false}];await wake();await waitFor("!document.querySelector('[data-upcoming-list]').textContent.includes('DEMO cleaning job')");
account={...account,roles:['landlord'],selectedRole:'landlord'};jobs=[{...job,participantRole:'landlord',canRespond:false,status:'confirmed',propertyName:'DEMO landlord property'}];
await browser.goto(server.origin+'/landlord/dashboard');await waitFor("!document.querySelector('[data-landlord-workspace]').hidden");
await waitFor("document.body.textContent.includes('DEMO landlord property')");
jobs=[{...jobs[0],status:'completed'}];await wake();await waitFor("document.querySelector('[data-landlord-history-list]').textContent.includes('DEMO landlord property')");
console.log('PASS: a new invitation appears on the map without reload; acceptance removes it; calendar refresh removes cancelled work; landlord history updates after completion.');
}finally{await browser.close();await server.close();}


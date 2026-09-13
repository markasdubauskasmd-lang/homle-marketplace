import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {serveStatic,launchBrowser} from '../tools/browser-harness.mjs';
const account={userId:'11111111-1111-4111-8111-111111111111',displayName:'Preview Cleaner',roles:['cleaner'],selectedRole:'cleaner'};
let reviews=[{rating:5,qualityRating:4,punctualityRating:5,professionalismRating:4,communicationRating:null,createdAt:'2026-09-12T12:00:00Z',writtenReview:'Preview fixture: thorough and friendly.'}];
const server=await serveStatic({extraFiles:{
'/cleaner/performance':await readFile('public/cleaner-performance.html','utf8'),
'/api/marketplace/account':()=>({body:{account}}),
'/api/marketplace/cleaner/profile':()=>({body:{profile:{cleanerId:account.userId,completedJobCount:10,reviewCount:1,averageRating:5}}}),
'/api/marketplace/cleaner/availability':()=>({body:{availability:[]}}),
'/api/marketplace/cleaner/onboarding':()=>({body:{sections:[]}}),
['/api/marketplace/cleaners/'+account.userId+'/reviews']:()=>({body:{reviews}})
}});
const browser=await launchBrowser();
try {await browser.setViewport({width:1280,height:900,mobile:false});await browser.goto(server.origin+'/cleaner/performance');
for(let i=0;i<100;i++){try{if(await browser.evaluate(`document.querySelectorAll('.hc-criterion').length === 6`))break;}catch{}await new Promise(r=>setTimeout(r,100));}
assert.equal(await browser.evaluate(`document.querySelectorAll('.hc-criterion').length`),6);
assert.equal(await browser.evaluate(`document.querySelector('.hc-criterion-value').textContent`),'4.0 / 5');
assert.equal(await browser.evaluate(`document.querySelector('.hp-meter span').style.width`),'80%');
assert.equal(await browser.evaluate(`document.querySelectorAll('.hc-criterion-value')[4].textContent`),'Awaiting data');
assert.equal(await browser.evaluate(`document.querySelector('[data-rank-result]').textContent`),'82.00 / 100 · Silver');
for (const [rating, expected] of [[3,'64.00 / 100 · Bronze'],[4.5,'91.00 / 100 · Gold'],[4.8,'96.40 / 100 · Platinum'],[1,'28.00 / 100 · Developing']]) {
 await browser.evaluate(`document.querySelectorAll('[data-rank-example]').forEach(input => {input.value = '${rating}'; input.dispatchEvent(new Event('input'));}); return true;`);
 assert.equal(await browser.evaluate(`document.querySelector('[data-rank-result]').textContent`),expected);
}
await browser.evaluate(`document.querySelector('[data-rank-example]').value = ''; document.querySelector('[data-rank-example]').dispatchEvent(new Event('input')); return true;`);
assert.match(await browser.evaluate(`document.querySelector('[data-rank-result]').textContent`),/Enter ratings/);
await browser.evaluate(`document.querySelectorAll('[data-rank-example]').forEach(input => {input.value = '4'; input.dispatchEvent(new Event('input'));}); return true;`);
assert.equal(await browser.evaluate(`document.querySelectorAll('.hp-faq details').length`),9);
assert.match(await browser.evaluate(`document.querySelector('.hp-faq').textContent`), /once every week/);
assert.match(await browser.evaluate(`document.querySelector('.hp-faq').textContent`), /greater priority for suitable job pings/);
assert.match(await browser.evaluate(`document.querySelector('.hp-faq').textContent`), /below Homlle’s required standards/);
await writeFile('artifacts/performance-preview.png',await browser.screenshot({fullPage:true}));
await browser.evaluate(`document.querySelector('#ranking-faq-title').scrollIntoView(); return true;`);
await writeFile('artifacts/ranking-faq-preview.png',await browser.screenshot({fullPage:true}));
await browser.setViewport({width:390,height:844,mobile:true});
assert.equal(await browser.evaluate(`document.documentElement.scrollWidth > innerWidth`),false);
await writeFile('artifacts/performance-mobile.png',await browser.screenshot({fullPage:true}));
console.log('PASS: six criteria, actual rating average, correct bar, missing data, mobile width.');
}finally{await browser.close();await server.close();}

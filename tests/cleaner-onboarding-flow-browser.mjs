import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {serveStatic,launchBrowser} from '../tools/browser-harness.mjs';
const account={userId:'11111111-1111-4111-8111-111111111111',email:'demo@example.invalid',displayName:'Demo',roles:['cleaner'],selectedRole:'cleaner'};
const sections={business:{data:{serviceType:'cleaner',businessType:'solo',businessName:'Demo Flow Test'}},banking:{data:{paymentFrequency:'weekly'}},identity:{data:{}}};
let writes=0,failSession=false;
const page=await readFile('public/cleaner-registration.html','utf8');
const extraFiles=Object.fromEntries(['business-details','banking','identity-verification','right-to-work'].map(slug=>['/cleaner/'+slug,page]));
Object.assign(extraFiles,{
 '/api/marketplace/account':()=>({body:{account}}),
 '/api/marketplace/cleaner/profile':()=>({body:{profile:{services:[],serviceAreas:[]}}}),
 '/api/marketplace/cleaner/availability':()=>({body:{availability:[]}}),
 '/api/marketplace/cleaner/payout-account':()=>({body:{payout:{ready:false,status:'action-required'}}}),
 '/api/marketplace/cleaner/onboarding':()=>({body:{sections:Object.entries(sections).map(([section,record])=>({section,...record}))}}),
 '/api/marketplace/cleaner/onboarding/documents':()=>({body:{documents:[]}}),
 '/api/marketplace/auth/session':()=>failSession?{status:401,body:{error:'Sign in again'}}:{body:{csrfToken:'fresh-csrf',account}}
});
for(const section of Object.keys(sections)) extraFiles['/api/marketplace/cleaner/onboarding/'+section]=({method,body,headers})=>{
 if(method==='PUT'){assert.equal(headers['x-csrf-token'],'fresh-csrf');sections[section]=JSON.parse(body);writes++;}
 return {body:{section:sections[section]}};
};
const server=await serveStatic({extraFiles});const browser=await launchBrowser();
async function waitFor(expression){for(let i=0;i<100;i++){try{if(await browser.evaluate(expression))return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+expression);}
try{
 await browser.goto(server.origin+'/cleaner/business-details');
 await waitFor("document.querySelector('[data-business-form] [name=businessName]').value==='Demo Flow Test'");
 await browser.evaluate("sessionStorage.setItem('tideway_csrf','expired-token');document.querySelector('[data-business-form]').requestSubmit(); return true;");
 await waitFor("location.pathname==='/cleaner/banking'");
 assert.equal(sections.business.data.businessName,'Demo Flow Test');assert.equal(writes,1);
 await waitFor("document.querySelector('[data-banking-provider-status]').textContent.includes('Stripe needs')");
 failSession=true;
 await browser.evaluate("document.querySelector('[data-banking-form]').requestSubmit()");
 await waitFor("document.body.textContent.includes('Sign in again')");assert.equal(writes,1,'Failed session recovery must not save or navigate');
 assert.equal(await browser.evaluate('location.pathname'),'/cleaner/banking');
 failSession=false;
 await browser.evaluate("document.querySelector('[data-banking-form]').requestSubmit()");
 await waitFor("location.pathname==='/cleaner/identity-verification'");assert.equal(writes,2);assert.equal(sections.banking.data.paymentFrequency,'weekly');
 assert(!('accountNumber' in sections.banking.data),'Bank numbers must never enter onboarding payloads');
 await browser.goto(server.origin+'/cleaner/business-details');
 await waitFor("document.querySelector('[data-business-form] [name=businessName]').value==='Demo Flow Test'");
 console.log('Onboarding browser flow passed: business save/readback, refreshed CSRF, failed-session retry, banking continuation without claiming payouts ready, and no bank-number payload.');
}finally{await browser.close();await server.close();}

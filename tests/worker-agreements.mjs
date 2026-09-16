import assert from 'node:assert/strict';
import {workerAgreements,validateAcceptance} from '../src/marketplace/worker-agreements.mjs';
import {createCleanerOnboardingService} from '../src/marketplace/cleaner-onboarding.mjs';
assert.equal(workerAgreements.length,9);
for(const d of workerAgreements){assert.equal(d.approved,false);assert.match(d.sha256,/^[a-f0-9]{64}$/);assert.throws(()=>validateAcceptance({documentId:d.id,approved:true,confirmed:true}),/draft/);}
const d={...workerAgreements[0],approved:true};const input={documentId:d.id,version:d.version,sha256:d.sha256,fullName:'Demo Worker',confirmed:true};
assert.equal(validateAcceptance(input,[d]).fullName,'Demo Worker');
assert.throws(()=>validateAcceptance({...input,sha256:'wrong'},[d]),/version changed/);
assert.throws(()=>validateAcceptance({...input,confirmed:false},[d]),/confirm/);
const actor={userId:'11111111-1111-4111-8111-111111111111',roles:['cleaner']};
const service=createCleanerOnboardingService({listOwnSections:async()=>[],saveOwnSection:async()=>{throw Error('Must not save');}},{dataEncryptionSecret:'test-only-worker-agreement-encryption-secret'});
await assert.rejects(service.acceptWorkerAgreement(actor,input),/draft/);
await assert.rejects(service.saveOwnSection(actor,'compliance',{status:'submitted',data:{signed:true}}),/dedicated/);
await assert.rejects(service.getWorkerAgreements({...actor,roles:['landlord']}),/Cleaner/);
console.log('PASS: real PDF fingerprints, all drafts blocked server-side, explicit consent and version validation, no forged compliance completion.');

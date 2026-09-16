import assert from 'node:assert/strict';
import './process-lifecycle.mjs';
import {readFileSync} from 'node:fs';
import {createPaymentService} from '../src/marketplace/payment-service.mjs';
import {paymentCommandWritesPaused} from '../src/marketplace/payment-command-policy.mjs';
const id='11111111-1111-4111-8111-111111111111';
const administrator={userId:id,roles:['administrator']},landlord={userId:id,roles:['landlord']},cleaner={userId:id,roles:['cleaner']};
const calls=[];
const blocked=name=>async()=>{calls.push(name);throw Error('Unwanted effect: '+name);};
const repository=Object.fromEntries(['getByBooking','listForAdministrator','getForAdministratorBooking','beginAuthorization','recordAuthorization','beginCommand','recordCommand','reconcileEvent','claimCommandAttempt','recordCommandRecovery','getCommandAttempt','getAdministratorCommandRecovery'].map(name=>[name,blocked(name)]));
const provider={name:'stripe',...Object.fromEntries(['createAuthorization','createSandboxCheckout','retrieveAuthorization','capture','cancel','refund','transfer','verifyWebhook','prepareCommandAttempt','discoverCommandObject'].map(name=>[name,blocked(name)]))};
const options={publishableKey:'pk_test_'+ 'p'.repeat(32),commandWritesPaused:true};
assert.equal(paymentCommandWritesPaused({}),false);
assert.equal(paymentCommandWritesPaused({PAYMENT_COMMAND_WRITES_PAUSED:'false'}),false);
assert.equal(paymentCommandWritesPaused({PAYMENT_COMMAND_WRITES_PAUSED:' TRUE '}),true);
for(const value of ['', 'no', '0', 'on'])assert.throws(()=>paymentCommandWritesPaused({PAYMENT_COMMAND_WRITES_PAUSED:value}),/true or false/);
assert.throws(()=>createPaymentService(repository,provider,{...options,commandWritesPaused:'false'}),/boolean/);
const service=createPaymentService(repository,provider,options);
for(const kind of ['capture','cancel','refund','transfer']) {
 for(const actor of kind==='cancel'?[administrator,landlord]:[administrator])
  await assert.rejects(()=>service[kind](actor,{paymentId:id,amountPence:100,idempotencyKey:'a'.repeat(40)}),error=>error.statusCode===503&&error.code==='payment-command-writes-paused');
 await assert.rejects(()=>service[kind](cleaner,{}),error=>error.statusCode===403);
}
assert.deepEqual(calls,[],'Pause performed a database write or contacted Stripe');
// Non-command capabilities still execute their original path; no broad provider
// or Cleaner payout gate is substituted for this narrow fence.
await assert.rejects(()=>service.beginAuthorization(landlord,{bookingId:id,idempotencyKey:'a'.repeat(40)}),/Unwanted effect: beginAuthorization/);
await assert.rejects(()=>service.handleWebhook(Buffer.from('{}'),'synthetic-signature'),/Unwanted effect: verifyWebhook/);
assert.deepEqual(calls,['beginAuthorization','verifyWebhook']);
const runtime=readFileSync(new URL('../src/marketplace/runtime.mjs',import.meta.url),'utf8');
assert.match(runtime,/createPaymentService\([^\n]+commandWritesPaused/);
assert.match(runtime,/createCleanerPayoutService\(cleanerPayoutRepository, options.paymentProvider, \{ appOrigin: environment.appOrigin \}\)/);
assert.match(runtime,/paymentCommandWritesPaused: commandWritesPaused/);
assert.match(readFileSync(new URL('../src/marketplace/attachment.mjs',import.meta.url),'utf8'),/paymentCommandWritesPaused: runtime.paymentCommandWritesPaused === true/);
assert.match(readFileSync(new URL('../server.mjs',import.meta.url),'utf8'),/paymentCommandWritesPaused: marketplaceAttachment.paymentCommandWritesPaused === true/);
console.log('Payment command pause passed: all settlement paths stop before effects, role boundaries stay intact, auth/webhook paths stay open and health exposes the gate.');

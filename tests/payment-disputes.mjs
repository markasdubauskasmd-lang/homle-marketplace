import assert from 'node:assert/strict';
import {createStripePaymentProvider} from '../src/marketplace/stripe-payment-provider.mjs';
import {createPaymentService} from '../src/marketplace/payment-service.mjs';
import {createPaymentRepository} from '../src/marketplace/payment-repository.mjs';

const paymentId='55555555-5555-4555-8555-555555555555';
const commandId='66666666-6666-4666-8666-666666666666';
const bookingId='44444444-4444-4444-8444-444444444444';
let event, query, transferred=0;
const client={accounts:{},accountLinks:{},refunds:{},transfers:{create(){transferred++;}},
  paymentIntents:{async retrieve(id){return {id,metadata:{tideway_payment_id:paymentId,tideway_command_id:commandId}};}},
  charges:{async retrieve(id){return {id,payment_intent:'pi_dispute_payment'};}},
  webhooks:{constructEvent(body,signature){if(signature!=='signed')throw Error('bad signature');return event;}}
};
const provider=await createStripePaymentProvider({secretKey:'sk_test_'+ 'a'.repeat(32),webhookSecret:'whsec_'+ 'b'.repeat(32)},{stripeClient:client});
const repository=createPaymentRepository({
  async withUserTransaction(actor,work){return work({async query(){throw Object.assign(Error('payment-dispute-review-required'),{code:'P0001'});}});},
  async withAuthenticationTransaction(work){return work({async query(text,values){query={text,values};return {rows:[{result:{accepted:true,duplicate:false,requiresReview:true}}]};}});}
});
const service=createPaymentService(repository,provider,{publishableKey:'pk_test_'+ 'c'.repeat(32)});
for(const type of ['charge.dispute.created','charge.dispute.updated','charge.dispute.closed']) {
  for(const status of ['won','lost','warning_closed','prevented','under_review','warning_needs_response','future_status',undefined]) {
    event={id:'evt_dispute_test',type,livemode:false,created:Math.floor(Date.now()/1000),data:{object:{id:'du_test_case',charge:'ch_test_charge',status,amount:2300,currency:'gbp'}}};
    const projected=await provider.verifyWebhook(Buffer.from('{}'),'signed');
    assert.equal(projected.commandId,null,'Capture metadata must not turn a dispute into a command result');
    assert.equal(projected.disputeId,'du_test_case');
    assert.equal(projected.disputeStatus,status==='future_status'||status==null?'unknown':status);
    assert.equal(projected.amountPence,null,'Dispute amount is not a captured/refunded total');
    assert.equal(projected.kind,type==='charge.dispute.closed'?'dispute-closed':'dispute-opened');
    await service.handleWebhook(Buffer.from(JSON.stringify(event)),'signed');
    assert.match(query.text,/reconcile_payment_dispute_event/);
    assert.equal(query.values.length,12);
    assert.deepEqual(query.values.slice(4,8),[paymentId,null,null,null]);
    assert.equal(query.values[10],'du_test_case');
    assert.equal(query.values[11],projected.disputeStatus);
    assert.match(query.values[9],/^[a-f0-9]{64}$/);
  }
}
event.data.object.id='pi_not_a_dispute';
await assert.rejects(service.handleWebhook(Buffer.from('{}'),'signed'),/invalid dispute id/);
await assert.rejects(service.handleWebhook(Buffer.from('{}'),'unsigned'),error=>error.code==='invalid-payment-webhook');
await assert.rejects(service.transfer({userId:'10000000-0000-4000-8000-000000000004',roles:['administrator']},
  {paymentId,idempotencyKey:'d'.repeat(64)}),error=>error.code==='payment-dispute-review-required'&&error.statusCode===409);
assert.equal(transferred,0,'A rejected existing transfer retry must never call Stripe');
console.log('Dispute pipeline passed: signed identity/outcome through adapter, service and repository; capture metadata isolation; unknown outcomes and blocked transfer retry.');

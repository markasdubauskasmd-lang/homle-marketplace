import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { optionalRequestScope, pricingRequestFromManualTasks, requestTasksFromLines, requestedWindow, moneyToPence } from '../public/landlord-dashboard-model.js';
import { quoteRooms } from '../public/pricing-engine.js';
import { defaultPricingConfig } from '../public/pricing-config.js';

const root = new URL('../', import.meta.url);
const journey = await readFile(new URL('public/landlord-journey.js', root), 'utf8');
const dashboard = await readFile(new URL('public/landlord-dashboard.js', root), 'utf8');
const section = (source, start, end) => {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert(first >= 0 && last > first);
  return source.slice(first, last);
};
const journeyHandler = section(journey, 'async function createOrRecoverRequest(', '// Saves what the scan actually saw');
const manualHandler = section(dashboard, 'async function createRequestDraft(', 'function setPending(');
const services = ['regular-domestic', 'deep-cleans', 'end-of-tenancy', 'workplaces', 'rental-turnovers', 'communal-areas'];
const frequencies = ['one-time', 'weekly', 'fortnightly', 'every-four-weeks'];
const durations = [120, 180, 240, 300, 360, 480];
const starts = Array.from({ length: 21 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const equalFields = ['propertyId', 'requestedStartAt', 'requestedEndAt', 'cleaningType', 'requiredServices', 'specialInstructions', 'budgetPence', 'frequency', 'tasks', 'submit'];
let cases = 0;
const fixedWindow = (date, time, duration) => requestedWindow(date, time, duration, new Date('2026-10-07T12:00:00Z'));

for (const service of services) for (const frequency of frequencies) for (const duration of durations) for (const time of starts) {
  const taskText = 'Kitchen: clean worktops\nBathroom: clean sink';
  const fields = { propertyId: '20000000-0000-4000-8000-000000000001', requestedDate: '2026-10-08', requestedTime: time,
    durationMinutes: String(duration), cleaningType: service, frequency, tasks: taskText, specialInstructions: '', budget: '', scopeReviewed: 'on' };
  let manualPayload, journeyPayload;
  const manual = vm.createContext({
    requestFeedback: {}, requestForm: { reportValidity: () => true, elements: { scopeReviewed: {} } },
    requestDraftPending: false, requestSave: { textContent: 'Save' }, requestContinue: {},
    FormData: class { get(name) { return fields[name]; } }, optionalRequestScope, requestedWindow: fixedWindow, moneyToPence, pricingRequestFromManualTasks,
    setRequestDraftControlsLocked() {}, setPending() {}, recoverCsrf: async () => 'fixture-csrf', showFeedback() {},
    saveManualRequest: async (_csrf, body) => { manualPayload = JSON.parse(JSON.stringify(body)); throw new Error('Fixture stops before storage'); }
  });
  vm.runInContext(manualHandler, manual);
  await manual.createRequestDraft();
  const state = { scanRooms: [], draft: { requestId: '', propertyId: fields.propertyId, date: fields.requestedDate, time,
    durationMinutes: duration, serviceCode: service, frequency, tasks: taskText.split('\n'), transcript: '' } };
  const scanManual = vm.createContext({ state, requestedWindow: fixedWindow, requestTasksFromLines, pricingRequestFromManualTasks, saveDraft() {}, randomId: () => '30000000-0000-4000-8000-000000000001',
    requestJson: async (_url, options) => { journeyPayload = JSON.parse(options.body); return { cleaningRequest: { requestId: journeyPayload.id } }; } });
  vm.runInContext(journeyHandler, scanManual);
  await scanManual.createOrRecoverRequest('fixture-csrf', fields.propertyId);
  assert(manualPayload && journeyPayload, 'A handler did not reach its fixture save boundary');
  for (const key of equalFields) assert.deepEqual(journeyPayload[key], manualPayload[key], `${service}/${frequency}/${duration}/${time}: ${key}`);
  assert.deepEqual(journeyPayload.pricingRequest, manualPayload.pricingRequest, "The same written scope received different pricing inputs");
  assert(journeyPayload.pricingRequest, "A text-only request omitted its pricing input");
  assert.equal(quoteRooms(journeyPayload.pricingRequest, defaultPricingConfig).priceable, true);
  cases++;
}
assert.equal(cases, 3024);
console.log("Manual payload parity passed: 3024 service/frequency/duration/start combinations carry identical scope and pricing inputs through both actual save handlers; all writes are fixtures.");

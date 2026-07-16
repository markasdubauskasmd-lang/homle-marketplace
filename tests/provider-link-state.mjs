import assert from "node:assert/strict";
import { createProviderLinkState } from "../src/marketplace/provider-link-state.mjs";

const secret = "provider-link-state-secret-longer-than-thirty-two-characters";
const context = { sessionId: "11111111-1111-4111-8111-111111111111", actor: { userId: "22222222-2222-4222-8222-222222222222", roles: ["landlord"] } };
let now = Date.parse("2026-07-16T10:00:00.000Z");
const state = createProviderLinkState({ secret, appOrigin: "https://tidewaycleaning.co.uk", clock: () => now, randomBytes: (size) => Buffer.alloc(size, 7) });

const cookie = state.begin(context, "google");
assert.ok(cookie.startsWith("__Host-tideway_provider_link=") && cookie.includes("Path=/") && cookie.includes("HttpOnly") && cookie.includes("SameSite=Lax") && cookie.includes("Max-Age=600") && cookie.includes("Secure") && !cookie.includes(secret));
const requestCookie = cookie.split(";", 1)[0];
assert.deepEqual(state.verify(requestCookie, context, "google"), { provider: "google", userId: context.actor.userId, sessionId: context.sessionId });
assert.equal(state.has(`other=value; ${requestCookie}`), true);
assert.ok(state.clearCookie.includes("Max-Age=0") && state.clearCookie.includes("Secure"));

const stepUpFlow = state.beginStepUp(context, "google");
const stepUpFlowRequest = stepUpFlow.split(";", 1)[0];
assert.ok(stepUpFlow.startsWith("__Host-tideway_provider_step_up_flow=") && stepUpFlow.includes("SameSite=Lax") && state.hasStepUpFlow(stepUpFlowRequest));
assert.deepEqual(state.verifyStepUp(stepUpFlowRequest, context, "google"), { provider: "google", userId: context.actor.userId, sessionId: context.sessionId });
const recentStepUp = state.completeStepUp(context, "google");
const recentStepUpRequest = recentStepUp.split(";", 1)[0];
assert.ok(recentStepUp.startsWith("__Host-tideway_provider_step_up_recent=") && recentStepUp.includes("SameSite=Strict"));
assert.deepEqual(state.verifyRecentStepUp(recentStepUpRequest, context), { provider: "google", userId: context.actor.userId, sessionId: context.sessionId });
assert.ok(state.clearStepUpFlowCookie.includes("Max-Age=0") && state.clearRecentStepUpCookie.includes("SameSite=Strict"));
await assert.rejects(async () => state.verifyStepUp(stepUpFlowRequest, context, "facebook"), /security check/i);
await assert.rejects(async () => state.verifyRecentStepUp(recentStepUpRequest, { ...context, sessionId: "33333333-3333-4333-8333-333333333333" }), /security check/i);

await assert.rejects(async () => state.verify(`${requestCookie}x`, context, "google"), /missing or expired/i);
await assert.rejects(async () => state.verify(requestCookie, { ...context, sessionId: "33333333-3333-4333-8333-333333333333" }, "google"), /missing or expired/i);
await assert.rejects(async () => state.verify(requestCookie, context, "facebook"), /missing or expired/i);
now += 601_000;
await assert.rejects(async () => state.verify(requestCookie, context, "google"), /missing or expired/i);

const local = createProviderLinkState({ secret, appOrigin: "http://127.0.0.1:4173" });
assert.ok(local.begin(context, "facebook").startsWith("tideway_provider_link=") && !local.begin(context, "facebook").includes("; Secure"));
assert.throws(() => state.begin(context, "apple"), /supported provider/i);
assert.throws(() => createProviderLinkState({ secret: "short", appOrigin: "https://tidewaycleaning.co.uk" }), /32-character/i);

console.log("Provider-link state tests passed: link and recent-provider step-up cookies are purpose-separated, user/session/provider-bound, expiring, tamper-resistant and host-only in production.");

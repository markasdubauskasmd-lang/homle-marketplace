import { createAccountSessionService } from "../src/marketplace/account-session-service.mjs";
import { developmentSessionCookieName, sessionCookieName } from "../src/marketplace/session.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function throws(operation, fragment) {
  try { operation(); } catch (error) { return String(error.message).includes(fragment); }
  return false;
}

async function rejects(operation, fragment) {
  try { await operation(); } catch (error) { return String(error.message).includes(fragment); }
  return false;
}

const userId = "11111111-1111-4111-8111-111111111111";
const oldSessionId = "77777777-7777-4777-8777-777777777777";
const newSessionId = "88888888-8888-4888-8888-888888888888";
const secret = "account-session-service-secret-over-thirty-two-characters";
const calls = [];
let createdSessionId = oldSessionId;
const repository = {
  async createSession(actor, material, metadata) { calls.push({ kind: "create", actor, material, metadata }); return { id: createdSessionId }; },
  async revokeSession(actor, sessionId) { calls.push({ kind: "revoke", actor, sessionId }); return { id: sessionId }; },
  async revokeAllSessions(actor) { calls.push({ kind: "revoke-all", actor }); return 3; }
};
const account = {
  user_id: userId,
  email: "owner@example.com",
  email_verified_at: "2026-07-15T12:00:00.000Z",
  display_name: "Property Owner",
  selected_role: "landlord",
  roles: ["landlord"],
  password_hash: "must-not-leak"
};
const now = new Date("2026-07-15T15:00:00.000Z");
const service = createAccountSessionService(repository, { sessionSecret: secret, production: false, ttlSeconds: 3600, clock: () => new Date(now) });
const established = await service.establish(account, { userAgent: "Example Browser 1", ipAddress: "192.0.2.10" });
const createCall = calls[0];
assert(established.setCookie.startsWith(`${developmentSessionCookieName}=`) && established.setCookie.includes("HttpOnly") && established.setCookie.includes("SameSite=Lax") && !established.setCookie.includes("; Secure") && established.csrfToken.length >= 43 && established.expiresAt === "2026-07-15T16:00:00.000Z", "Development session did not return bounded opaque cookie and CSRF material.");
assert(established.account.userId === userId && !Object.hasOwn(established.account, "password_hash") && !Object.hasOwn(established, "token") && !Object.hasOwn(createCall.material, "token") && !Object.hasOwn(createCall.material, "csrfToken") && Buffer.isBuffer(createCall.material.tokenHash) && Buffer.isBuffer(createCall.material.csrfHash), "Session establishment exposed raw credentials/tokens to its response or repository boundary, or failed to store token hashes.");
assert(Buffer.isBuffer(createCall.metadata.userAgentHash) && Buffer.isBuffer(createCall.metadata.ipHash) && createCall.metadata.userAgentHash.length === 32 && createCall.metadata.ipHash.length === 32 && !JSON.stringify(createCall).includes("Example Browser 1") && !JSON.stringify(createCall).includes("192.0.2.10"), "Session metadata was stored raw instead of as keyed privacy hashes.");

createdSessionId = newSessionId;
const rotated = await service.rotate({ actor: { userId, roles: [] }, sessionId: oldSessionId }, { ...account, selected_role: "landlord", roles: ["landlord"] }, { userAgent: "Example Browser 1", ipAddress: "192.0.2.10" });
assert(calls[1].kind === "revoke" && calls[1].sessionId === oldSessionId && calls[2].kind === "create" && rotated.sessionId === newSessionId && rotated.setCookie !== established.setCookie, "Role/session rotation did not revoke the old session before issuing distinct material.");
const logout = await service.logout({ actor: { userId, roles: ["landlord"] }, sessionId: newSessionId });
assert(calls[3].kind === "revoke" && logout.setCookie.startsWith(`${developmentSessionCookieName}=deleted`) && logout.setCookie.includes("Max-Age=0"), "Logout did not revoke the exact current session and expire its cookie.");
const logoutAll = await service.logoutAll({ actor: { userId, roles: ["landlord"] }, sessionId: newSessionId });
assert(calls[4].kind === "revoke-all" && logoutAll.revokedSessions === 3 && logoutAll.setCookie.includes("Max-Age=0"), "Logout-all did not revoke every account session and expire the browser cookie.");

const productionRepository = { ...repository, async createSession() { return { id: oldSessionId }; } };
const productionService = createAccountSessionService(productionRepository, { sessionSecret: secret, production: true, ttlSeconds: 300, clock: () => new Date(now) });
const productionSession = await productionService.establish(account);
assert(productionSession.setCookie.startsWith(`${sessionCookieName}=`) && productionSession.setCookie.includes("; Secure") && productionSession.setCookie.includes("Path=/") && productionSession.setCookie.includes("HttpOnly"), "Production session did not use the host-only secure cookie boundary.");
assert(throws(() => createAccountSessionService(repository, { sessionSecret: "too-short" }), "32-character") && throws(() => createAccountSessionService(repository, { sessionSecret: secret, ttlSeconds: 299 }), "five minutes") && await rejects(() => service.rotate({ actor: { userId }, sessionId: "not-a-uuid" }, account), "valid session id"), "Session service accepted weak secrets, unsupported lifetimes or malformed session identifiers.");
let crossAccountRejected = false;
try { await service.rotate({ actor: { userId, roles: ["landlord"] }, sessionId: newSessionId }, { ...account, user_id: "22222222-2222-4222-8222-222222222222" }); } catch (error) { crossAccountRejected = error.message.includes("cannot change"); }
assert(crossAccountRejected, "Session rotation could switch the authenticated account.");

const failingCalls = [];
const failingService = createAccountSessionService({
  async createSession() { failingCalls.push("create"); throw new Error("database unavailable"); },
  async revokeSession() { failingCalls.push("revoke"); },
  async revokeAllSessions() { return 0; }
}, { sessionSecret: secret, production: true, ttlSeconds: 3600, clock: () => new Date(now) });
let rotationFailedClosed = false;
try { await failingService.rotate({ actor: { userId, roles: [] }, sessionId: oldSessionId }, account); } catch { rotationFailedClosed = failingCalls.join(",") === "revoke,create"; }
assert(rotationFailedClosed, "A failed privilege-changing rotation left the old session active.");

console.log("Account session tests passed: opaque cookie issuance, privacy-hashed metadata, public account projection, rotation, exact logout, logout-all and fail-closed privilege change.");

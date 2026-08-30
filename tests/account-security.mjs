import { createAccountSecurity, AccountHttpError } from "../src/marketplace/account-security.mjs";
import { createSessionMaterial, developmentSessionCookieName, sessionCookieName } from "../src/marketplace/session.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rejected(operation, statusCode, code) {
  try { await operation(); } catch (error) { return error instanceof AccountHttpError && error.statusCode === statusCode && error.code === code; }
  return false;
}

const secret = "account-security-test-secret-longer-than-32-characters";
const material = createSessionMaterial(secret, new Date("2026-07-15T15:00:00.000Z"), 3600);
const session = {
  session_id: "session-id",
  user_id: "11111111-1111-4111-8111-111111111111",
  email: "cleaner@example.com",
  email_verified_at: "2026-07-15T14:00:00.000Z",
  display_name: "Cleaner Example",
  avatar_url: "https://images.example.com/cleaner.jpg",
  selected_role: "cleaner",
  roles: ["cleaner"],
  csrf_secret_hash: material.csrfHash,
  expires_at: material.expiresAt
};
const repository = { async findSession(hash) { return hash.equals(material.tokenHash) ? session : null; } };
const security = createAccountSecurity(repository, { sessionSecret: secret, appOrigin: "https://tideway.example.com", production: true });
const authenticatedRequest = { headers: { cookie: `${sessionCookieName}=${material.token}` } };

assert(await rejected(() => security.authenticate({ headers: {} }), 401, "authentication-required"), "A private route accepted a missing session cookie.");
assert(await rejected(() => security.authenticate({ headers: { cookie: `${sessionCookieName}=invalid-token-that-is-definitely-long-enough-for-checking` } }), 401, "authentication-required"), "A private route accepted an unknown session token.");
assert(await rejected(() => security.authenticate({ headers: { cookie: `${developmentSessionCookieName}=${material.token}` } }), 401, "authentication-required"), "Production accepted the non-secure development cookie name.");

const context = await security.protect(authenticatedRequest, { roles: ["cleaner"] });
assert(context.actor.userId === session.user_id && context.actor.roles.length === 1 && context.account.avatarUrl === session.avatar_url && !Object.hasOwn(context, "token") && !Object.hasOwn(context.account, "password_hash"), "Authenticated context lost role identity/provider avatar or exposed credentials.");
assert(await rejected(() => security.protect(authenticatedRequest, { roles: ["landlord"] }), 403, "role-rejected"), "A cleaner entered a landlord-only route.");
assert(await rejected(() => security.protect({ headers: { ...authenticatedRequest.headers, origin: "https://attacker.example", "x-csrf-token": material.csrfToken } }, { mutation: true }), 403, "origin-rejected"), "A cross-origin cookie mutation was accepted.");
assert(await rejected(() => security.protect({ headers: { ...authenticatedRequest.headers, origin: "https://tideway.example.com" } }, { mutation: true }), 403, "csrf-rejected"), "A cookie mutation without CSRF was accepted.");
assert(await rejected(() => security.protect({ headers: { ...authenticatedRequest.headers, origin: "https://tideway.example.com", "x-csrf-token": `${material.csrfToken}x` } }, { mutation: true }), 403, "csrf-rejected"), "A cookie mutation accepted the wrong CSRF token.");
const mutationContext = await security.protect({ headers: { ...authenticatedRequest.headers, origin: "https://tideway.example.com", "x-csrf-token": material.csrfToken } }, { mutation: true, roles: ["cleaner"] });
assert(mutationContext.sessionId === session.session_id, "An exact-origin mutation with valid session, CSRF and role was rejected.");

// The mutation allowance. It has to be charged only once the request has proved
// it comes from the account whose budget it spends — otherwise anyone able to
// aim a cross-site request at a signed-in browser could exhaust that account's
// allowance without ever holding its CSRF token.
const charged = [];
function meteredSecurity(outcome = () => {}) {
  return createAccountSecurity(repository, {
    sessionSecret: secret,
    appOrigin: "https://tideway.example.com",
    production: true,
    onMutation: async (context) => { charged.push(context.actor.userId); await outcome(); }
  });
}
const metered = meteredSecurity();
const mutationHeaders = { ...authenticatedRequest.headers, origin: "https://tideway.example.com", "x-csrf-token": material.csrfToken };

await metered.protect({ headers: mutationHeaders }, { mutation: true, roles: ["cleaner"] });
assert(charged.length === 1 && charged[0] === session.user_id, "An accepted mutation did not spend the acting account's allowance.");

await metered.protect(authenticatedRequest, { roles: ["cleaner"] });
assert(charged.length === 1, "A read charged the mutation allowance.");

await rejected(() => metered.protect({ headers: { ...authenticatedRequest.headers, origin: "https://attacker.example", "x-csrf-token": material.csrfToken } }, { mutation: true }), 403, "origin-rejected");
await rejected(() => metered.protect({ headers: { ...authenticatedRequest.headers, origin: "https://tideway.example.com" } }, { mutation: true }), 403, "csrf-rejected");
await rejected(() => metered.protect({ headers: mutationHeaders }, { mutation: true, roles: ["landlord"] }), 403, "role-rejected");
assert(charged.length === 1, "A mutation refused for origin, CSRF or role still spent the account's allowance.");

const exhausted = meteredSecurity(() => { throw Object.assign(new Error("Too many requests. Try again later."), { statusCode: 429, code: "rate-limited" }); });
let refusal = null;
try { await exhausted.protect({ headers: mutationHeaders }, { mutation: true, roles: ["cleaner"] }); } catch (error) { refusal = error; }
assert(refusal?.statusCode === 429 && refusal.code === "rate-limited", "An exhausted mutation allowance did not refuse the write.");

let composed = null;
try { composed = createAccountSecurity(repository, { sessionSecret: secret, appOrigin: "https://tideway.example.com", onMutation: "not-a-function" }); } catch (error) { composed = error; }
assert(composed instanceof TypeError, "A non-function mutation allowance was accepted at composition.");

const pendingSession = { ...session, selected_role: null, roles: [] };
const pendingSecurity = createAccountSecurity({ async findSession() { return pendingSession; } }, { sessionSecret: secret, appOrigin: "http://127.0.0.1:4173", production: false });
const pendingContext = await pendingSecurity.protect({ headers: { cookie: `${developmentSessionCookieName}=${material.token}` } });
assert(pendingContext.actor.roles.length === 0 && await rejected(() => pendingSecurity.protect({ headers: { cookie: `${developmentSessionCookieName}=${material.token}` } }, { roles: ["cleaner"] }), 403, "role-rejected"), "Role-pending onboarding received cleaner authority before selection.");

console.log("Account security tests passed: exact cookie boundary, hashed session lookup, exact-origin and CSRF mutation checks, role authorization, the per-account mutation allowance and role-pending onboarding isolation.");

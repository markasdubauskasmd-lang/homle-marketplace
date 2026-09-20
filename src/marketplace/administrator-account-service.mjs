import { uuid, uuidPattern } from "./validation.mjs";

const accountStatuses = new Set(["active", "suspended"]);
// The column also permits these. They are readable, because an Administrator
// searching for somebody needs to see that their account is already on its way
// out, but they can never be set from here -- see migration 129.
const readableStatuses = new Set(["active", "suspended", "deletion-pending", "deleted"]);
const marketplaceRoles = ["landlord", "cleaner", "administrator"];

function requireAdministrator(actor) {
  if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.includes("administrator")) {
    throw Object.assign(new Error("A Homle Administrator account is required."), { statusCode: 403, code: "administrator-required" });
  }
}

function timestamp(value, label, optional = false) {
  if (optional && value == null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is unavailable.`);
  return new Date(value).toISOString();
}

function count(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} is unavailable.`);
  return parsed;
}

/**
 * The account an Administrator is about to act on.
 *
 * Projects the email, because identifying the right person before suspending
 * them is the entire point, and nothing else about them: no address, no
 * booking history, no payment detail. This is a control surface, not a customer
 * record viewer.
 */
function account(record) {
  if (!record || typeof record !== "object" || !uuidPattern.test(record.accountId || "")) throw new Error("The account record is unavailable.");
  if (!readableStatuses.has(record.accountStatus)) throw new Error("The account status is unavailable.");
  const roles = Array.isArray(record.roles) ? record.roles.filter((role) => marketplaceRoles.includes(role)) : [];
  return Object.freeze({
    accountId: record.accountId,
    email: typeof record.email === "string" ? record.email.slice(0, 320) : "",
    displayName: typeof record.displayName === "string" ? record.displayName.slice(0, 160) : "",
    accountStatus: record.accountStatus,
    emailVerifiedAt: timestamp(record.emailVerifiedAt, "Account verification time", true),
    createdAt: timestamp(record.createdAt, "Account creation time"),
    roles: Object.freeze([...new Set(roles)].sort()),
    // Shown so the decision is made with it in view. Suspending a Cleaner who
    // has a job tomorrow leaves a customer expecting somebody who will not
    // arrive, and nothing here cancels those automatically.
    liveBookings: count(record.liveBookings, "Live booking count")
  });
}

export function createAdministratorAccountService(repository) {
  if (!repository || typeof repository.find !== "function" || typeof repository.setStatus !== "function") {
    throw new TypeError("A complete Administrator account repository is required.");
  }
  return Object.freeze({
    /**
     * Find one account, by exact email or id.
     *
     * Deliberately not a browsable directory. An Administrator suspending an
     * account already knows who they are looking for, and a free-text search
     * across every customer who ever signed up is a different feature with a
     * different privacy question behind it.
     */
    async find(actor, identifier) {
      requireAdministrator(actor);
      const supplied = String(identifier ?? "").trim();
      if (supplied.length < 3 || supplied.length > 320) throw new TypeError("Search by the account's exact email address or id.");
      return account(await repository.find(actor, supplied));
    },
    async setStatus(actor, accountId, input = {}) {
      requireAdministrator(actor);
      const accountStatus = String(input.accountStatus || "").trim().toLowerCase();
      if (!accountStatuses.has(accountStatus)) throw new TypeError("Choose whether the account is active or suspended.");
      const reason = String(input.reason ?? "").replace(/\r\n?/g, "\n").trim();
      // Checked here as well as at the database so an Administrator gets a
      // usable message rather than a constraint error, and because the length
      // is the difference between a reason and a shrug.
      if (reason.length < 10 || reason.length > 1000) throw new TypeError("Record why this account is being suspended or restored, in at least ten characters.");
      const result = await repository.setStatus(actor, { accountId: uuid(accountId, "account id"), accountStatus, reason });
      if (!result || typeof result !== "object" || !accountStatuses.has(result.accountStatus) || typeof result.changed !== "boolean") {
        throw new Error("The account status update is unavailable.");
      }
      return Object.freeze({
        accountId: uuid(result.accountId, "account id"),
        accountStatus: result.accountStatus,
        previousStatus: readableStatuses.has(result.previousStatus) ? result.previousStatus : "active",
        changed: result.changed,
        revokedSessions: count(result.revokedSessions, "Revoked session count"),
        liveBookings: count(result.liveBookings, "Live booking count")
      });
    }
  });
}

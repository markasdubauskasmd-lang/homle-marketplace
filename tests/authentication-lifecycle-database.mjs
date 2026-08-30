// Execute the authentication lifecycle functions against a real PostgreSQL
// database, through psql, exactly as the application calls them.
//
// The existing coverage asserted that the migration text contained these
// function names and exercised the services against a fake repository. Neither
// runs a line of SQL, which is how two total launch blockers reached the
// release: `consume_email_verification` and `consume_password_reset` both
// aborted with `column reference "user_id" is ambiguous` the first time they
// executed, so no account could ever be verified and no password could ever be
// reset.
//
// This runs only against a database the operator names in
// DATABASE_VERIFICATION_URL, and skips loudly otherwise, matching how the other
// database-backed checks in this repository behave. It writes and removes its
// own disposable rows and touches nothing else.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const connectionUrl = String(process.env.DATABASE_VERIFICATION_URL || "").trim();
if (!connectionUrl) {
  console.log("Authentication lifecycle database checks SKIPPED: set DATABASE_VERIFICATION_URL to a disposable migrated database to run them.");
  process.exit(0);
}
if (spawnSync("psql", ["--version"], { encoding: "utf8" }).status !== 0) {
  console.log("Authentication lifecycle database checks SKIPPED: psql is not available on this machine.");
  process.exit(0);
}

function query(sql) {
  const result = spawnSync("psql", [connectionUrl, "-v", "ON_ERROR_STOP=1", "-tAc", sql], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`psql failed: ${String(result.stderr || "").trim().slice(0, 400)}`);
  return String(result.stdout || "").trim();
}

// A syntactically valid scrypt hash in the format the schema enforces. It is
// not a real credential: no password produces it and nothing signs in with it.
const placeholderHash = "$scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const email = `lifecycle-probe-${randomUUID()}@example.invalid`;
const verificationHash = randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64);
const resetHash = randomUUID().replace(/-/g, "").padEnd(64, "1").slice(0, 64);

try {
  const registered = query(`SELECT tideway_private.register_password_account(
    '${email}'::citext, 'Lifecycle Probe', '${placeholderHash}',
    decode('${verificationHash}','hex'), now() + interval '1 hour')`);
  assert.equal(registered, "t", "register_password_account must create the account");

  // The defect that shipped: this call raised `column reference "user_id" is
  // ambiguous` and returned a 500 for every customer who clicked their link.
  const verified = query(`SELECT email FROM tideway_private.consume_email_verification(decode('${verificationHash}','hex'))`);
  assert.equal(verified, email, "consume_email_verification must consume the token and return the verified account");

  const verifiedAt = query(`SELECT email_verified_at IS NOT NULL FROM users WHERE email = '${email}'::citext`);
  assert.equal(verifiedAt, "t", "the account must be recorded as verified");

  const replayed = query(`SELECT count(*) FROM tideway_private.consume_email_verification(decode('${verificationHash}','hex'))`);
  assert.equal(replayed, "0", "a consumed verification token must not be usable twice");

  const account = query(`SELECT email_verified_at IS NOT NULL FROM tideway_private.lookup_password_account('${email}'::citext)`);
  assert.equal(account, "t", "lookup_password_account must find the verified account so sign-in can succeed");

  const issued = query(`SELECT tideway_private.issue_password_reset('${email}'::citext, decode('${resetHash}','hex'), now() + interval '1 hour')`);
  assert.equal(issued, "t", "issue_password_reset must issue a reset token");

  // The second defect that shipped: password recovery was impossible, and the
  // session revocation that a password change is supposed to perform never ran.
  const reset = query(`SELECT sessions_revoked FROM tideway_private.consume_password_reset(decode('${resetHash}','hex'), '${placeholderHash}')`);
  assert.match(reset, /^\d+$/, "consume_password_reset must complete and report how many sessions it revoked");

  const replayedReset = query(`SELECT count(*) FROM tideway_private.consume_password_reset(decode('${resetHash}','hex'), '${placeholderHash}')`);
  assert.equal(replayedReset, "0", "a consumed reset token must not be usable twice");

  console.log("Authentication lifecycle database checks passed: registration, email verification, single-use tokens, account lookup and password reset all execute against real PostgreSQL.");
} finally {
  const identifier = email.replace(/'/g, "''");
  spawnSync("psql", [connectionUrl, "-tAc", `DELETE FROM users WHERE email = '${identifier}'::citext`], { encoding: "utf8" });
}

import assert from "node:assert/strict";
import {
  accountEntryPath,
  accountIntentFromSearch,
  accountIntentLifetimeMs,
  clearAccountIntent,
  normalizeAccountIntent,
  readAccountIntent,
  saveAccountIntent
} from "../public/account-intent.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

const now = Date.UTC(2026, 6, 16, 15, 0, 0);
const storage = memoryStorage();

assert.equal(normalizeAccountIntent("book"), "book");
assert.equal(normalizeAccountIntent("https://attacker.example"), "");
assert.equal(accountIntentFromSearch("?intent=book"), "book");
assert.equal(accountIntentFromSearch("?intent=book&intent=book"), "");
assert.equal(accountIntentFromSearch("?intent=https%3A%2F%2Fattacker.example"), "");
assert.equal(accountEntryPath("book"), "/signup?intent=book");
assert.equal(accountEntryPath("javascript:alert(1)"), "/signup");

assert.equal(saveAccountIntent(storage, "book", now), "book");
assert.equal(readAccountIntent(storage, now + accountIntentLifetimeMs - 1), "book");
assert.equal(readAccountIntent(storage, now + accountIntentLifetimeMs), "");

saveAccountIntent(storage, "book", now);
clearAccountIntent(storage);
assert.equal(readAccountIntent(storage, now), "");

storage.setItem("tideway_account_intent", JSON.stringify({ version: 1, intent: "https://attacker.example", savedAt: now, expiresAt: now + accountIntentLifetimeMs }));
assert.equal(readAccountIntent(storage, now), "");

console.log("Account intent tests passed: fixed booking action, bounded browser lifetime, expiry, cleanup and open-redirect rejection.");

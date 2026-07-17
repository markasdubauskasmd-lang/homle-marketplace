import assert from "node:assert/strict";
import {
  accountEntryPath,
  accountIntentFromSearch,
  accountIntentLifetimeMs,
  clearAccountIntent,
  clearSelectedCleaner,
  normalizeAccountIntent,
  normalizeSelectedCleaner,
  readAccountIntent,
  readSelectedCleaner,
  saveAccountIntent,
  saveSelectedCleaner,
  selectedCleanerFromSearch
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
const cleanerId = "22222222-2222-4222-8222-222222222222";

assert.equal(normalizeAccountIntent("book"), "book");
assert.equal(normalizeAccountIntent("work"), "work");
assert.equal(normalizeAccountIntent("https://attacker.example"), "");
assert.equal(accountIntentFromSearch("?intent=book"), "book");
assert.equal(accountIntentFromSearch("?intent=work"), "work");
assert.equal(accountIntentFromSearch("?intent=book&intent=book"), "");
assert.equal(accountIntentFromSearch("?intent=https%3A%2F%2Fattacker.example"), "");
assert.equal(accountEntryPath("book"), "/signup?intent=book");
assert.equal(accountEntryPath("book", cleanerId), `/signup?intent=book&cleaner=${cleanerId}`);
assert.equal(accountEntryPath("work", cleanerId), "/signup?intent=work");
assert.equal(accountEntryPath("javascript:alert(1)"), "/signup");
assert.equal(normalizeSelectedCleaner(cleanerId.toUpperCase()), cleanerId);
assert.equal(normalizeSelectedCleaner("not-a-cleaner"), "");
assert.equal(selectedCleanerFromSearch(`?intent=book&cleaner=${cleanerId}`), cleanerId);
assert.equal(selectedCleanerFromSearch(`?cleaner=${cleanerId}&cleaner=${cleanerId}`), "");

assert.equal(saveAccountIntent(storage, "book", now), "book");
assert.equal(readAccountIntent(storage, now + accountIntentLifetimeMs - 1), "book");
assert.equal(readAccountIntent(storage, now + accountIntentLifetimeMs), "");

saveAccountIntent(storage, "book", now);
clearAccountIntent(storage);
assert.equal(readAccountIntent(storage, now), "");

assert.equal(saveAccountIntent(storage, "work", now), "work");
assert.equal(readAccountIntent(storage, now + accountIntentLifetimeMs - 1), "work");
clearAccountIntent(storage);

assert.equal(saveSelectedCleaner(storage, cleanerId, now), cleanerId);
assert.equal(readSelectedCleaner(storage, now + accountIntentLifetimeMs - 1), cleanerId);
assert.equal(readSelectedCleaner(storage, now + accountIntentLifetimeMs), "");
saveSelectedCleaner(storage, cleanerId, now);
clearSelectedCleaner(storage);
assert.equal(readSelectedCleaner(storage, now), "");

storage.setItem("tidewaySelectedCleanerV1", JSON.stringify({ version: 1, cleanerId: "https://attacker.example", savedAt: now, expiresAt: now + accountIntentLifetimeMs }));
assert.equal(readSelectedCleaner(storage, now), "");

storage.setItem("tideway_account_intent", JSON.stringify({ version: 1, intent: "https://attacker.example", savedAt: now, expiresAt: now + accountIntentLifetimeMs }));
assert.equal(readAccountIntent(storage, now), "");

console.log("Account intent tests passed: fixed booking action, bounded selected-Cleaner handoff, expiry, cleanup and open-redirect rejection.");

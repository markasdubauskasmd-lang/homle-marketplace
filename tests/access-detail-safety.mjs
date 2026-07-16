import assert from "node:assert/strict";
import { accessDetailsSafetyMessage, containsSensitiveAccessDetails } from "../public/access-detail-safety.js";

for (const safe of [
  "Meet the site manager at reception",
  "Collect keys from the office",
  "The concierge will provide access",
  "Access details will be confirmed after booking",
  "No access codes stored",
  "Customer will be present"
]) assert.equal(containsSensitiveAccessDetails(safe), false, `Safe access approach was blocked: ${safe}`);

for (const sensitive of [
  "Door code is 1234",
  "Door code 7351",
  "Gate code is 12#",
  "Alarm PIN: *8901*",
  "Gate PIN: 8291",
  "Alarm code=2468",
  "Lockbox: 4821",
  "Lockbox 9632",
  "Key safe code is A19B",
  "The key is hidden under the doormat",
  "Keys are kept behind the blue bin",
  "Key under the plant pot",
  "The lockbox is behind the meter",
  "Disarm the alarm with 8822"
]) assert.equal(containsSensitiveAccessDetails(sensitive), true, `Sensitive access detail was accepted: ${sensitive}`);

assert(accessDetailsSafetyMessage.includes("only after a booking is accepted") && !/\d{3,}/.test(accessDetailsSafetyMessage), "The safe error message is not lifecycle-specific or contains secret-like material.");

console.log("Access-detail safety tests passed: general access approaches remain usable while codes, passwords and exact hidden-key locations are blocked before booking acceptance.");

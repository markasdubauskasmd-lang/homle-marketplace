import { readFile } from "node:fs/promises";
import { decryptPropertyAccessInstructions, encryptPropertyAccessInstructions } from "../src/marketplace/property-crypto.mjs";
import { createPropertyRepository } from "../src/marketplace/property-repository.mjs";
import { createPropertyService, normalizedProperty } from "../src/marketplace/property-service.mjs";

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

const landlordId = "11111111-1111-4111-8111-111111111111";
const cleanerId = "22222222-2222-4222-8222-222222222222";
const unrelatedId = "33333333-3333-4333-8333-333333333333";
const propertyId = "44444444-4444-4444-8444-444444444444";
const bookingId = "55555555-5555-4555-8555-555555555555";
const encryptionSecret = "property-test-key-with-at-least-thirty-two-characters";
const accessInstructions = "Collect the lockbox from the concierge and return the key after cleaning.";

const encryptedOne = encryptPropertyAccessInstructions(accessInstructions, propertyId, encryptionSecret);
const encryptedTwo = encryptPropertyAccessInstructions(accessInstructions, propertyId, encryptionSecret);
assert(Buffer.isBuffer(encryptedOne) && !encryptedOne.equals(encryptedTwo) && !encryptedOne.includes(Buffer.from(accessInstructions)) && decryptPropertyAccessInstructions(encryptedOne, propertyId, encryptionSecret) === accessInstructions, "Property access instructions were not randomized, encrypted and recoverable.");
const tampered = Buffer.from(encryptedOne);
tampered[tampered.length - 1] ^= 1;
assert(throws(() => decryptPropertyAccessInstructions(tampered, propertyId, encryptionSecret), "authenticated") && throws(() => decryptPropertyAccessInstructions(encryptedOne, "66666666-6666-4666-8666-666666666666", encryptionSecret), "authenticated") && throws(() => decryptPropertyAccessInstructions(encryptedOne, propertyId, `${encryptionSecret}x`), "authenticated"), "Encrypted property instructions were not bound to their key, property and integrity tag.");

const input = {
  id: propertyId,
  name: "Canal View Flat",
  addressLine1: "10 Example Street",
  addressLine2: "Flat 3",
  locality: "London",
  postcode: "sw1a1aa",
  propertyType: "flat",
  bedrooms: 2,
  bathrooms: 1.5,
  approximateSizeSqM: 82,
  accessInstructions,
  parkingInstructions: "Use visitor bay 4 only.",
  cleaningPreferences: "Use fragrance-free products.",
  savedChecklist: [{ roomName: "Kitchen", description: "Clean oven exterior" }],
  specialNotes: "A cat may be present.",
  latitude: 51.501,
  longitude: -0.142
};
const canonical = normalizedProperty(input, encryptionSecret);
assert(canonical.postcode === "SW1A 1AA" && canonical.id === propertyId && Buffer.isBuffer(canonical.accessInstructionsCiphertext) && canonical.savedChecklist.length === 1, "Property input was not validated and canonicalized.");
const safelyNamed = normalizedProperty({ ...input, name: "" }, encryptionSecret);
assert(safelyNamed.name === "Flat in London" && !safelyNamed.name.includes(input.addressLine1), "An omitted property label was not replaced with a privacy-safe type-and-locality name.");
assert(throws(() => normalizedProperty({ ...input, bathrooms: 1.25 }, encryptionSecret), "supported range") && throws(() => normalizedProperty({ ...input, postcode: "London" }, encryptionSecret), "valid UK postcode") && throws(() => normalizedProperty({ ...input, longitude: null }, encryptionSecret), "supplied together") && throws(() => normalizedProperty({ ...input, savedChecklist: Array.from({ length: 101 }, () => input.savedChecklist[0]) }, encryptionSecret), "too many"), "Invalid property numbers, location or checklist data were accepted.");

function propertyRow(property, status = "confirmed") {
  return {
    id: property.id,
    name: property.name,
    address_line_1: property.addressLine1,
    address_line_2: property.addressLine2,
    locality: property.locality,
    postcode: property.postcode,
    property_type: property.propertyType,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    approximate_size_sq_m: property.approximateSizeSqM,
    access_instructions_ciphertext: property.accessInstructionsCiphertext,
    parking_instructions: property.parkingInstructions,
    cleaning_preferences: property.cleaningPreferences,
    saved_checklist: property.savedChecklist,
    special_notes: property.specialNotes,
    latitude: property.latitude,
    longitude: property.longitude,
    landlord_user_id: landlordId,
    booking_landlord_user_id: landlordId,
    booking_cleaner_user_id: cleanerId,
    booking_status: status
  };
}

let storedProperty;
let bookingStatus = "confirmed";
const repositoryCalls = [];
const fakeRepository = {
  async saveLandlordProfile(actor, profile) { repositoryCalls.push({ kind: "profile", actor, profile }); return profile; },
  async createProperty(actor, property) { repositoryCalls.push({ kind: "create", actor, property }); storedProperty = property; return propertyRow(property); },
  async updateOwnProperty(actor, property) { repositoryCalls.push({ kind: "update", actor, property }); storedProperty = property; return propertyRow(property); },
  async listOwnProperties(actor) { repositoryCalls.push({ kind: "list", actor }); return [propertyRow(storedProperty)]; },
  async getBookingProperty(actor, selectedBookingId) { repositoryCalls.push({ kind: "booking", actor, selectedBookingId }); return propertyRow(storedProperty, bookingStatus); }
};
const service = createPropertyService(fakeRepository, { dataEncryptionSecret: encryptionSecret });
const landlord = { userId: landlordId, roles: ["landlord"] };
const cleaner = { userId: cleanerId, roles: ["cleaner"] };
const unrelated = { userId: unrelatedId, roles: ["cleaner"] };

await service.saveLandlordProfile(landlord, { organisationName: "Example Property Management", biography: "Small local portfolio." });
const created = await service.createProperty(landlord, input);
assert(created.exactAddress.postcode === "SW1A 1AA" && created.accessInstructions === accessInstructions && !Object.hasOwn(created, "accessInstructionsCiphertext") && !Object.hasOwn(created, "latitude") && !Object.hasOwn(created, "landlordUserId"), "The landlord property projection exposed storage or coordinate fields or omitted owned details.");
assert(Buffer.isBuffer(repositoryCalls.find((call) => call.kind === "create").property.accessInstructionsCiphertext) && !JSON.stringify(created).includes("access_instructions_ciphertext"), "Property service sent plaintext access instructions to persistence or leaked ciphertext to its response.");
const updatedInstructions = "Use the side entrance. The lockbox code is 9876.";
const updated = await service.updateOwnProperty(landlord, { ...input, id: propertyId, accessInstructions: updatedInstructions });
const updateCall = repositoryCalls.find((call) => call.kind === "update");
assert(updated.propertyId === propertyId && updated.accessInstructions === updatedInstructions && Buffer.isBuffer(updateCall.property.accessInstructionsCiphertext) && !updateCall.property.accessInstructionsCiphertext.includes(Buffer.from(updatedInstructions)), "An owner property edit did not preserve identity, encrypt the replacement access instructions or return the protected owner projection.");
assert((await service.listOwnProperties(landlord))[0].accessInstructions === updatedInstructions, "A landlord could not retrieve their updated protected property details.");
assert(throws(() => createPropertyService(fakeRepository, { dataEncryptionSecret: "too-short" }), "at least 32") && await rejects(() => service.createProperty(cleaner, input), "Landlord account") && await rejects(() => service.updateOwnProperty(cleaner, { ...input, id: propertyId }), "Landlord account"), "Property service accepted a weak encryption key or a cleaner property write.");

bookingStatus = "confirmed";
const activeCleanerView = await service.getBookingProperty(cleaner, bookingId);
assert(activeCleanerView.exactAddress.postcode === "SW1A 1AA" && activeCleanerView.accessInstructions === updatedInstructions, "The assigned cleaner could not access the latest visit details during a confirmed booking.");
bookingStatus = "pending-cleaner-acceptance";
const invitedCleanerView = await service.getBookingProperty(cleaner, bookingId);
assert(invitedCleanerView.exactAddress === null && invitedCleanerView.accessInstructions === null && invitedCleanerView.parkingInstructions === null && invitedCleanerView.specialNotes === null, "An unaccepted cleaner could see private property details.");
bookingStatus = "completed";
const completedCleanerView = await service.getBookingProperty(cleaner, bookingId);
assert(completedCleanerView.exactAddress === null && completedCleanerView.accessInstructions === null, "A completed booking retained unnecessary cleaner access to the property address or entry instructions.");
bookingStatus = "draft";
assert((await service.getBookingProperty(landlord, bookingId)).accessInstructions === updatedInstructions, "The property owner lost access to their own latest instructions outside an active visit.");
bookingStatus = "confirmed";
assert(await rejects(() => service.getBookingProperty(unrelated, bookingId), "forbidden"), "An unrelated authenticated user could access booking property data when a lower layer returned a row.");

const databaseCalls = [];
const database = {
  async withUserTransaction(actor, operation) {
    return operation({ async query(text, values) {
      databaseCalls.push({ actor, text, values });
      if (text.startsWith("INSERT INTO properties") || text.startsWith("UPDATE properties")) return { rows: [propertyRow(canonical)] };
      if (text.includes("FROM bookings b")) return { rows: [propertyRow(canonical)] };
      return { rows: [] };
    } });
  }
};
const repository = createPropertyRepository(database);
await repository.createProperty(landlord, canonical);
await repository.updateOwnProperty(landlord, canonical);
await repository.listOwnProperties(landlord);
await repository.getBookingProperty(cleaner, bookingId);
assert(databaseCalls[0].values[1] === landlordId && databaseCalls[1].text.includes("WHERE id=$1::uuid AND landlord_user_id=$2::uuid") && databaseCalls[1].values[1] === landlordId && databaseCalls[1].text.includes("address_line_1 IS NOT DISTINCT FROM $4::text") && databaseCalls[1].text.includes("COALESCE($17::numeric,latitude)") && databaseCalls[1].text.includes("ELSE $17::numeric") && databaseCalls[2].text.includes("landlord_user_id=$1::uuid") && databaseCalls[3].text.includes("b.landlord_user_id=$2::uuid OR b.cleaner_user_id=$2::uuid") && databaseCalls.every((call) => !call.text.includes(accessInstructions)), "Property repository did not bind ownership, preserve unchanged-address coordinates, clear stale changed-address coordinates or protect booking participation in parameterized queries.");

const rls = await readFile(new URL("../db/migrations/002_marketplace_row_level_security.sql", import.meta.url), "utf8");
const propertyPolicy = rls.match(/CREATE POLICY properties_confirmed_cleaner_read[^;]+;/)?.[0] || "";
const photoPolicy = rls.match(/CREATE POLICY property_photos_confirmed_cleaner_read[^;]+;/)?.[0] || "";
for (const policy of [propertyPolicy, photoPolicy]) {
  assert(policy.includes("cleaner_user_id = tideway_private.current_user_id()") && policy.includes("'confirmed'") && policy.includes("'awaiting-review'") && !policy.includes("'completed'") && !policy.includes("'disputed'"), "Property or photo RLS did not match the least-retention active-booking access window.");
}

console.log("Property privacy tests passed: validated owner-bound writes, authenticated encryption, participant projections and active-booking-only cleaner access to addresses, entry notes and photos.");

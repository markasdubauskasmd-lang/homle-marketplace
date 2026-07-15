import { randomUUID } from "node:crypto";
import { isUkPostcode } from "../../public/contact-validation.js";
import { canAccessBooking, canAccessProtectedPropertyInstructions } from "./domain.mjs";
import { assertPropertyEncryptionSecret, decryptPropertyAccessInstructions, encryptPropertyAccessInstructions } from "./property-crypto.mjs";

const propertyTypes = Object.freeze(["house", "flat", "studio", "office", "retail", "clinic", "communal", "other"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function boundedText(value, maximum, label, minimum = 0) {
  const normalized = typeof value === "string" ? value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") : "";
  if (normalized.length < minimum || normalized.length > maximum) throw new TypeError(`${label} must contain ${minimum} to ${maximum} characters.`);
  return normalized;
}

function boundedNumber(value, minimum, maximum, label, decimalPlaces = null) {
  if (value == null || value === "") return null;
  const number = Number(value);
  const scale = decimalPlaces == null ? true : Number.isInteger(number * (10 ** decimalPlaces));
  if (!Number.isFinite(number) || !scale || number < minimum || number > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return number;
}

function uuid(value, label) {
  if (!uuidPattern.test(value || "")) throw new TypeError(`A valid ${label} is required.`);
  return value.toLowerCase();
}

function postcode(value) {
  const normalized = boundedText(value, 12, "Postcode", 5).toUpperCase().replace(/\s+/g, " ");
  if (!isUkPostcode(normalized)) throw new TypeError("A valid UK postcode is required.");
  const compact = normalized.replace(/\s/g, "");
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

function savedChecklist(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > 100) throw new TypeError("Saved checklist has too many tasks.");
  return value.map((task, index) => ({
    roomName: boundedText(task?.roomName, 120, `Checklist room ${index + 1}`, 1),
    description: boundedText(task?.description, 1000, `Checklist task ${index + 1}`, 1)
  }));
}

function normalizedCoordinates(latitudeValue, longitudeValue) {
  const latitude = boundedNumber(latitudeValue, -90, 90, "Property latitude");
  const longitude = boundedNumber(longitudeValue, -180, 180, "Property longitude");
  if ((latitude == null) !== (longitude == null)) throw new TypeError("Property coordinates must be supplied together.");
  return { latitude, longitude };
}

export function normalizedLandlordProfile(input = {}) {
  return {
    organisationName: boundedText(input.organisationName, 160, "Organisation name") || null,
    biography: boundedText(input.biography, 1200, "Landlord biography")
  };
}

export function normalizedProperty(input = {}, dataEncryptionSecret, id = input.id || randomUUID()) {
  const selectedPropertyId = uuid(id, "property id");
  const selectedType = boundedText(input.propertyType, 40, "Property type", 1);
  if (!propertyTypes.includes(selectedType)) throw new TypeError("A supported property type is required.");
  const coordinates = normalizedCoordinates(input.latitude, input.longitude);
  const accessInstructions = boundedText(input.accessInstructions, 3000, "Access instructions");
  return {
    id: selectedPropertyId,
    name: boundedText(input.name, 160, "Property name", 1),
    addressLine1: boundedText(input.addressLine1, 240, "Address line 1", 1),
    addressLine2: boundedText(input.addressLine2, 240, "Address line 2") || null,
    locality: boundedText(input.locality, 120, "Locality", 1),
    postcode: postcode(input.postcode),
    propertyType: selectedType,
    bedrooms: boundedNumber(input.bedrooms, 0, 200, "Bedrooms", 1),
    bathrooms: boundedNumber(input.bathrooms, 0, 200, "Bathrooms", 1),
    approximateSizeSqM: boundedNumber(input.approximateSizeSqM, 1, 1_000_000, "Approximate size", 0),
    accessInstructionsCiphertext: encryptPropertyAccessInstructions(accessInstructions, selectedPropertyId, dataEncryptionSecret),
    parkingInstructions: boundedText(input.parkingInstructions, 1200, "Parking instructions") || null,
    cleaningPreferences: boundedText(input.cleaningPreferences, 3000, "Cleaning preferences") || null,
    savedChecklist: savedChecklist(input.savedChecklist),
    specialNotes: boundedText(input.specialNotes, 3000, "Special notes") || null,
    ...coordinates
  };
}

function recordChecklist(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function propertyProjection(record, includeSensitive, dataEncryptionSecret) {
  const result = {
    propertyId: record.id,
    name: record.name,
    propertyType: record.property_type,
    bedrooms: record.bedrooms == null ? null : Number(record.bedrooms),
    bathrooms: record.bathrooms == null ? null : Number(record.bathrooms),
    approximateSizeSqM: record.approximate_size_sq_m == null ? null : Number(record.approximate_size_sq_m),
    cleaningPreferences: record.cleaning_preferences || "",
    savedChecklist: recordChecklist(record.saved_checklist),
    exactAddress: null,
    accessInstructions: null,
    parkingInstructions: null,
    specialNotes: null
  };
  if (includeSensitive) {
    result.exactAddress = { addressLine1: record.address_line_1, addressLine2: record.address_line_2 || "", locality: record.locality, postcode: record.postcode };
    result.accessInstructions = decryptPropertyAccessInstructions(record.access_instructions_ciphertext, record.id, dataEncryptionSecret);
    result.parkingInstructions = record.parking_instructions || "";
    result.specialNotes = record.special_notes || "";
  }
  return result;
}

function bookingFromRecord(record) {
  return {
    landlordUserId: record.booking_landlord_user_id,
    cleanerUserId: record.booking_cleaner_user_id,
    status: record.booking_status
  };
}

export function createPropertyService(repository, options) {
  if (!repository || typeof repository.saveLandlordProfile !== "function" || typeof repository.createProperty !== "function" || typeof repository.updateOwnProperty !== "function" || typeof repository.listOwnProperties !== "function" || typeof repository.getBookingProperty !== "function") throw new TypeError("A complete property repository is required.");
  const dataEncryptionSecret = options?.dataEncryptionSecret;
  assertPropertyEncryptionSecret(dataEncryptionSecret);
  return {
    saveLandlordProfile(actor, input) {
      if (!actor?.userId || !actor.roles?.includes("landlord")) throw new TypeError("A Landlord account is required.");
      return repository.saveLandlordProfile(actor, normalizedLandlordProfile(input));
    },
    async createProperty(actor, input) {
      if (!actor?.userId || !actor.roles?.includes("landlord")) throw new TypeError("A Landlord account is required.");
      const saved = await repository.createProperty(actor, normalizedProperty(input, dataEncryptionSecret));
      return propertyProjection(saved, true, dataEncryptionSecret);
    },
    async updateOwnProperty(actor, input) {
      if (!actor?.userId || !actor.roles?.includes("landlord")) throw new TypeError("A Landlord account is required.");
      const saved = await repository.updateOwnProperty(actor, normalizedProperty(input, dataEncryptionSecret, input?.id));
      if (!saved) throw Object.assign(new Error("Property was not found."), { statusCode: 404 });
      return propertyProjection(saved, true, dataEncryptionSecret);
    },
    async listOwnProperties(actor) {
      if (!actor?.userId || !actor.roles?.includes("landlord")) throw new TypeError("A Landlord account is required.");
      return (await repository.listOwnProperties(actor)).map((record) => propertyProjection(record, true, dataEncryptionSecret));
    },
    async getBookingProperty(actor, bookingId) {
      if (!actor?.userId) throw new TypeError("An authenticated account is required.");
      const record = await repository.getBookingProperty(actor, uuid(bookingId, "booking id"));
      if (!record) throw Object.assign(new Error("Booking property was not found."), { statusCode: 404 });
      const booking = bookingFromRecord(record);
      if (!canAccessBooking(actor, booking)) throw Object.assign(new Error("Booking property access is forbidden."), { statusCode: 403 });
      return propertyProjection(record, canAccessProtectedPropertyInstructions(actor, booking), dataEncryptionSecret);
    }
  };
}

export { propertyTypes };

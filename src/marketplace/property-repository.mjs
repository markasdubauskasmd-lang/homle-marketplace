export function createPropertyRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return {
    getLandlordProfile(actor) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query(
          "SELECT user_id, organisation_name, biography, updated_at FROM landlord_profiles WHERE user_id=$1::uuid LIMIT 1",
          [actor.userId]
        );
        return result.rows[0] || null;
      });
    },
    saveLandlordProfile(actor, profile) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query(
          "INSERT INTO landlord_profiles (user_id, organisation_name, biography) VALUES ($1::uuid, $2::text, $3::text) ON CONFLICT (user_id) DO UPDATE SET organisation_name=EXCLUDED.organisation_name, biography=EXCLUDED.biography, updated_at=now() RETURNING user_id, organisation_name, biography, updated_at",
          [actor.userId, profile.organisationName, profile.biography]
        );
        return result.rows[0];
      });
    },
    createProperty(actor, property) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query(
          "INSERT INTO properties (id, landlord_user_id, name, address_line_1, address_line_2, locality, postcode, property_type, bedrooms, bathrooms, approximate_size_sq_m, access_instructions_ciphertext, parking_instructions, cleaning_preferences, saved_checklist, special_notes, latitude, longitude) VALUES ($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text, $9::numeric, $10::numeric, $11::integer, $12::bytea, $13::text, $14::text, $15::jsonb, $16::text, $17::numeric, $18::numeric) RETURNING *",
          [property.id, actor.userId, property.name, property.addressLine1, property.addressLine2, property.locality, property.postcode, property.propertyType, property.bedrooms, property.bathrooms, property.approximateSizeSqM, property.accessInstructionsCiphertext, property.parkingInstructions, property.cleaningPreferences, property.savedChecklist, property.specialNotes, property.latitude, property.longitude]
        );
        return result.rows[0];
      });
    },
    updateOwnProperty(actor, property) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query(
          "UPDATE properties SET name=$3::text, address_line_1=$4::text, address_line_2=$5::text, locality=$6::text, postcode=$7::text, property_type=$8::text, bedrooms=$9::numeric, bathrooms=$10::numeric, approximate_size_sq_m=$11::integer, access_instructions_ciphertext=$12::bytea, parking_instructions=$13::text, cleaning_preferences=$14::text, saved_checklist=$15::jsonb, special_notes=$16::text, latitude=CASE WHEN address_line_1 IS NOT DISTINCT FROM $4::text AND address_line_2 IS NOT DISTINCT FROM $5::text AND locality IS NOT DISTINCT FROM $6::text AND postcode IS NOT DISTINCT FROM $7::text THEN COALESCE($17::numeric,latitude) ELSE $17::numeric END, longitude=CASE WHEN address_line_1 IS NOT DISTINCT FROM $4::text AND address_line_2 IS NOT DISTINCT FROM $5::text AND locality IS NOT DISTINCT FROM $6::text AND postcode IS NOT DISTINCT FROM $7::text THEN COALESCE($18::numeric,longitude) ELSE $18::numeric END, updated_at=now() WHERE id=$1::uuid AND landlord_user_id=$2::uuid AND archived_at IS NULL RETURNING *",
          [property.id, actor.userId, property.name, property.addressLine1, property.addressLine2, property.locality, property.postcode, property.propertyType, property.bedrooms, property.bathrooms, property.approximateSizeSqM, property.accessInstructionsCiphertext, property.parkingInstructions, property.cleaningPreferences, property.savedChecklist, property.specialNotes, property.latitude, property.longitude]
        );
        return result.rows[0] || null;
      });
    },
    listOwnProperties(actor) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query("SELECT * FROM properties WHERE landlord_user_id=$1::uuid AND archived_at IS NULL ORDER BY name, id", [actor.userId]);
        return result.rows;
      });
    },
    getBookingProperty(actor, bookingId) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query(
          "SELECT p.*, b.id AS booking_id, b.landlord_user_id AS booking_landlord_user_id, b.cleaner_user_id AS booking_cleaner_user_id, b.status AS booking_status FROM bookings b JOIN properties p ON p.id=b.property_id WHERE b.id=$1::uuid AND (b.landlord_user_id=$2::uuid OR b.cleaner_user_id=$2::uuid OR $3::boolean) LIMIT 1",
          [bookingId, actor.userId, Array.isArray(actor.roles) && actor.roles.includes("administrator")]
        );
        return result.rows[0] || null;
      });
    }
  };
}

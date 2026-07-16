export function createCleanerProfileRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function" || typeof database.withAuthenticationTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return {
    getOwnProfile(actor) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query(
          `SELECT profile.user_id AS cleaner_id, profile.public_slug, profile.profile_photo_url, profile.biography,
             profile.hourly_rate_pence, profile.fixed_price_options, profile.travel_radius_km, profile.years_experience,
             profile.languages, profile.equipment_supplied, profile.products_supplied, profile.residential_preference,
             profile.commercial_preference, profile.profile_completion_percent, profile.current_availability_status,
             profile.is_public, COALESCE(services.records, '[]'::jsonb) AS services,
             COALESCE(areas.records, '[]'::jsonb) AS service_areas
           FROM cleaner_profiles profile
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(jsonb_build_object('serviceCode', service.service_code, 'pricingModel', service.pricing_model, 'pricePence', service.price_pence) ORDER BY service.service_code) AS records
             FROM cleaner_services service WHERE service.cleaner_user_id = profile.user_id
           ) services ON true
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(jsonb_build_object('outwardPostcode', area.outward_postcode, 'latitude', area.latitude, 'longitude', area.longitude) ORDER BY area.outward_postcode) AS records
             FROM cleaner_service_areas area WHERE area.cleaner_user_id = profile.user_id
           ) areas ON true
           WHERE profile.user_id=$1::uuid`,
          [actor.userId]
        );
        return result.rows[0] || null;
      });
    },
    saveOwnProfile(actor, profile) {
      return database.withUserTransaction(actor, async (client) => {
        const updated = await client.query(
          "UPDATE cleaner_profiles SET biography=$2::text, profile_photo_url=$3::text, hourly_rate_pence=$4::integer, fixed_price_options=$5::jsonb, travel_radius_km=$6::numeric, years_experience=$7::integer, languages=$8::text[], equipment_supplied=$9::text[], products_supplied=$10::text[], residential_preference=$11::boolean, commercial_preference=$12::boolean, profile_completion_percent=$13::integer, current_availability_status=$14::text, is_public=$15::boolean, updated_at=now() WHERE user_id=$1::uuid RETURNING user_id, public_slug, profile_completion_percent, is_public, updated_at",
          [actor.userId, profile.biography, profile.profilePhotoUrl, profile.hourlyRatePence, profile.fixedPriceOptions, profile.travelRadiusKm, profile.yearsExperience, profile.languages, profile.equipmentSupplied, profile.productsSupplied, profile.residentialPreference, profile.commercialPreference, profile.profileCompletionPercent, profile.currentAvailabilityStatus, profile.isPublic]
        );
        if (!updated.rows[0]) throw Object.assign(new Error("Cleaner profile was not found."), { statusCode: 404 });
        await client.query("DELETE FROM cleaner_services WHERE cleaner_user_id=$1::uuid", [actor.userId]);
        if (profile.services.length) {
          await client.query(
            "INSERT INTO cleaner_services (cleaner_user_id, service_code, pricing_model, price_pence) SELECT $1::uuid, service_code, pricing_model, price_pence FROM unnest($2::text[], $3::text[], $4::integer[]) AS supplied(service_code, pricing_model, price_pence)",
            [actor.userId, profile.services.map((service) => service.serviceCode), profile.services.map((service) => service.pricingModel), profile.services.map((service) => service.pricePence)]
          );
        }
        await client.query("DELETE FROM cleaner_service_areas WHERE cleaner_user_id=$1::uuid", [actor.userId]);
        if (profile.serviceAreas.length) {
          await client.query(
            "INSERT INTO cleaner_service_areas (cleaner_user_id, outward_postcode, latitude, longitude) SELECT $1::uuid, outward_postcode, latitude, longitude FROM unnest($2::text[], $3::numeric[], $4::numeric[]) AS supplied(outward_postcode, latitude, longitude)",
            [actor.userId, profile.serviceAreas.map((area) => area.outwardPostcode), profile.serviceAreas.map((area) => area.latitude), profile.serviceAreas.map((area) => area.longitude)]
          );
        }
        return updated.rows[0];
      });
    },
    searchPublicProfiles(filters) {
      return database.withAuthenticationTransaction(async (client) => {
        const result = await client.query(
          "SELECT * FROM tideway_private.search_cleaner_directory($1::text, $2::text, $3::timestamptz, $4::timestamptz, $5::numeric, $6::integer, $7::boolean, $8::numeric, $9::numeric, $10::numeric, $11::integer, $12::integer)",
          [filters.outwardPostcode, filters.serviceCode, filters.startAt, filters.endAt, filters.minimumRating, filters.maximumPricePence, filters.verifiedOnly, filters.latitude, filters.longitude, filters.maximumDistanceKm, filters.limit, filters.offset]
        );
        return result.rows;
      });
    }
  };
}

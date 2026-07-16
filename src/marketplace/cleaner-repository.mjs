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
          "UPDATE cleaner_profiles SET biography=$2::text, profile_photo_url=$3::text, hourly_rate_pence=$4::integer, fixed_price_options=$5::jsonb, travel_radius_km=$6::numeric, years_experience=$7::integer, languages=$8::text[], equipment_supplied=$9::text[], products_supplied=$10::text[], residential_preference=$11::boolean, commercial_preference=$12::boolean, profile_completion_percent=$13::integer, is_public=$14::boolean, updated_at=now() WHERE user_id=$1::uuid RETURNING user_id, public_slug, profile_completion_percent, current_availability_status, is_public, updated_at",
          [actor.userId, profile.biography, profile.profilePhotoUrl, profile.hourlyRatePence, profile.fixedPriceOptions, profile.travelRadiusKm, profile.yearsExperience, profile.languages, profile.equipmentSupplied, profile.productsSupplied, profile.residentialPreference, profile.commercialPreference, profile.profileCompletionPercent, profile.isPublic]
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
    listOwnAvailability(actor, currentTime) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query(
          "SELECT id, starts_at, ends_at, status FROM cleaner_availability WHERE cleaner_user_id=$1::uuid AND status IN ('available','held') AND ends_at>$2::timestamptz ORDER BY starts_at, ends_at LIMIT 100",
          [actor.userId, currentTime]
        );
        return result.rows;
      });
    },
    createOwnAvailability(actor, availability) {
      return database.withUserTransaction(actor, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('cleaner-availability:' || $1::text, 0))", [actor.userId]);
        const overlap = await client.query(
          "SELECT 1 FROM cleaner_availability WHERE cleaner_user_id=$1::uuid AND status IN ('available','held') AND tstzrange(starts_at,ends_at,'[)') && tstzrange($2::timestamptz,$3::timestamptz,'[)') LIMIT 1",
          [actor.userId, availability.startAt, availability.endAt]
        );
        if (overlap.rows.length) throw Object.assign(new Error("This time overlaps another availability window."), { statusCode: 409, code: "availability-overlap" });
        const inserted = await client.query(
          "INSERT INTO cleaner_availability (cleaner_user_id,starts_at,ends_at,status,source) VALUES ($1::uuid,$2::timestamptz,$3::timestamptz,'available','cleaner') RETURNING id,starts_at,ends_at,status",
          [actor.userId, availability.startAt, availability.endAt]
        );
        await client.query("UPDATE cleaner_profiles SET current_availability_status='available',updated_at=now() WHERE user_id=$1::uuid", [actor.userId]);
        return inserted.rows[0];
      });
    },
    withdrawOwnAvailability(actor, availabilityId, currentTime) {
      return database.withUserTransaction(actor, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('cleaner-invitation:' || $1::text, 0)), pg_advisory_xact_lock(hashtextextended('cleaner-availability:' || $1::text, 0))", [actor.userId]);
        const selected = await client.query(
          "SELECT id,starts_at,ends_at,status FROM cleaner_availability WHERE id=$1::uuid AND cleaner_user_id=$2::uuid",
          [availabilityId, actor.userId]
        );
        const availability = selected.rows[0];
        if (!availability) throw Object.assign(new Error("This availability window was not found."), { statusCode: 404, code: "availability-not-found" });
        if (availability.status !== "available" || new Date(availability.ends_at) <= new Date(currentTime)) throw Object.assign(new Error("This availability window can no longer be changed."), { statusCode: 409, code: "availability-closed" });
        const booking = await client.query(
          "SELECT 1 FROM bookings WHERE cleaner_user_id=$1::uuid AND status IN ('cleaner-invited','pending-cleaner-acceptance','confirmed','cleaner-en-route','cleaner-arrived','cleaning-in-progress','awaiting-review','disputed') AND tstzrange(scheduled_start_at,scheduled_end_at,'[)') && tstzrange($2::timestamptz,$3::timestamptz,'[)') LIMIT 1",
          [actor.userId, availability.starts_at, availability.ends_at]
        );
        if (booking.rows.length) throw Object.assign(new Error("Decline or resolve the overlapping request or job before removing this time."), { statusCode: 409, code: "availability-booked" });
        const updated = await client.query(
          "UPDATE cleaner_availability SET status='withdrawn',updated_at=now() WHERE id=$1::uuid AND cleaner_user_id=$2::uuid AND status='available' RETURNING id,starts_at,ends_at,status",
          [availabilityId, actor.userId]
        );
        const remaining = await client.query("SELECT 1 FROM cleaner_availability WHERE cleaner_user_id=$1::uuid AND status='available' AND ends_at>$2::timestamptz LIMIT 1", [actor.userId, currentTime]);
        if (!remaining.rows.length) await client.query("UPDATE cleaner_profiles SET current_availability_status='unavailable',updated_at=now() WHERE user_id=$1::uuid", [actor.userId]);
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

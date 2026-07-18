export function createFavouriteCleanerRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return Object.freeze({
    listOwn(actor) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query(
          `SELECT favourite.cleaner_user_id AS cleaner_id, cleaner.public_slug, cleaner.profile_photo_url,
             cleaner.current_availability_status, cleaner.average_rating, cleaner.review_count,
             cleaner.completed_job_count, account.display_name, favourite.created_at,
             COALESCE(services.records, '[]'::jsonb) AS services
           FROM favourite_cleaners favourite
           JOIN cleaner_profiles cleaner ON cleaner.user_id=favourite.cleaner_user_id AND cleaner.is_public=true
           JOIN users account ON account.id=cleaner.user_id AND account.status='active'
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(jsonb_build_object('serviceCode', service.service_code, 'pricingModel', service.pricing_model, 'pricePence', service.price_pence) ORDER BY service.service_code) AS records
             FROM cleaner_services service WHERE service.cleaner_user_id=cleaner.user_id
           ) services ON true
           WHERE favourite.landlord_user_id=$1::uuid
           ORDER BY favourite.created_at DESC, favourite.cleaner_user_id
           LIMIT 100`,
          [actor.userId]
        );
        return result.rows;
      });
    },
    setOwn(actor, cleanerId, favourite) {
      return database.withUserTransaction(actor, async (client) => {
        if (favourite) {
          const visible = await client.query("SELECT 1 FROM cleaner_profiles profile JOIN users account ON account.id=profile.user_id AND account.status='active' WHERE profile.user_id=$1::uuid AND profile.is_public=true", [cleanerId]);
          if (!visible.rows.length) throw Object.assign(new Error("This public Cleaner profile is no longer available."), { statusCode: 404, code: "cleaner-not-public" });
          await client.query("INSERT INTO favourite_cleaners (landlord_user_id,cleaner_user_id) VALUES ($1::uuid,$2::uuid) ON CONFLICT (landlord_user_id,cleaner_user_id) DO NOTHING", [actor.userId, cleanerId]);
        } else {
          await client.query("DELETE FROM favourite_cleaners WHERE landlord_user_id=$1::uuid AND cleaner_user_id=$2::uuid", [actor.userId, cleanerId]);
        }
        return { cleaner_id: cleanerId, favourite };
      });
    }
  });
}

export function createCleanerOnboardingRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return Object.freeze({
    updateOwnCompliance(actor, transform) {
      return database.withUserTransaction(actor, async client => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',[`compliance:${actor.userId}`]);
        const records=await client.query('SELECT * FROM tideway_private.get_my_cleaner_onboarding_sections()');
        const update=await transform(records.rows.find(row=>row.section_code==='compliance'));
        return (await client.query('SELECT * FROM tideway_private.save_my_cleaner_onboarding_section($1::text,$2::bytea,$3::text,$4::smallint)',['compliance',update.payloadCiphertext,update.status,1])).rows[0];
      });
    },
    updateOwnTraining(actor, transform) {
      return database.withUserTransaction(actor, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [`training:${actor.userId}`]);
        const records = await client.query("SELECT * FROM tideway_private.get_my_cleaner_onboarding_sections()");
        const update = await transform(records.rows.find(row => row.section_code === 'training'));
        const result = await client.query("SELECT * FROM tideway_private.save_my_cleaner_onboarding_section($1::text,$2::bytea,$3::text,$4::smallint)", ['training', update.payloadCiphertext, 'draft', 1]);
        return result.rows[0];
      });
    },
    listOwnSections(actor) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query("SELECT * FROM tideway_private.get_my_cleaner_onboarding_sections()");
        return result.rows;
      });
    },
    saveOwnSection(actor, section) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query(
          "SELECT * FROM tideway_private.save_my_cleaner_onboarding_section($1::text,$2::bytea,$3::text,$4::smallint)",
          [section.section, section.payloadCiphertext, section.status, section.schemaVersion]
        );
        return result.rows[0];
      });
    }
  });
}

export function createCleanerOnboardingRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return Object.freeze({
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

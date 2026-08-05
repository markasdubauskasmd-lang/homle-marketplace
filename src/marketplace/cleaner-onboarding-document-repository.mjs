export function createCleanerOnboardingDocumentRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return Object.freeze({
    listOwnDocuments(actor, section) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query("SELECT * FROM tideway_private.list_my_cleaner_onboarding_documents($1::text)", [section]);
        return result.rows;
      });
    },
    saveOwnDocument(actor, document) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query(
          "SELECT * FROM tideway_private.save_my_cleaner_onboarding_document($1::text,$2::text,$3::bytea,$4::text,$5::text,$6::integer,$7::text,$8::bytea)",
          [document.section, document.documentType, document.objectKeyCiphertext, document.filename, document.mimeType, document.sizeBytes, document.checksumSha256, document.contentCiphertext]
        );
        return result.rows[0];
      });
    },
    getOwnDocument(actor, section, documentType) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query("SELECT * FROM tideway_private.get_my_cleaner_onboarding_document($1::text,$2::text)", [section, documentType]);
        return result.rows[0] || null;
      });
    },
    deleteOwnDocument(actor, section, documentType) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query("SELECT * FROM tideway_private.delete_my_cleaner_onboarding_document($1::text,$2::text)", [section, documentType]);
        return result.rows[0] || null;
      });
    }
  });
}

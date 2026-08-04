export function createCleanerProfilePhotoRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return Object.freeze({
    saveOwnPhoto(actor, photo) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query(
          "SELECT * FROM tideway_private.save_my_cleaner_profile_photo($1::bytea,$2::text,$3::integer,$4::text,$5::integer,$6::integer)",
          [photo.bytes, photo.mimeType, photo.byteSize, photo.checksumSha256, photo.width, photo.height]
        );
        return result.rows[0];
      });
    },
    getOwnPhoto(actor) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query("SELECT * FROM tideway_private.get_my_cleaner_profile_photo()");
        return result.rows[0] || null;
      });
    }
  });
}

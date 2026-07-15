const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizedEmail(email) {
  if (typeof email !== "string") throw new TypeError("An email address is required.");
  const value = email.trim().toLowerCase();
  const at = value.indexOf("@");
  if (value.length > 254 || at < 1 || at !== value.lastIndexOf("@") || at === value.length - 1) throw new TypeError("A valid email address is required.");
  return value;
}

function tokenHash(value, label) {
  if (!Buffer.isBuffer(value) || value.length !== 32) throw new TypeError(`${label} must be a 32-byte token hash.`);
  return value;
}

function uuid(value, label) {
  if (!uuidPattern.test(value || "")) throw new TypeError(`${label} must be a valid UUID.`);
  return value.toLowerCase();
}

export function createAuthenticationRepository(database) {
  if (!database || typeof database.withAuthenticationTransaction !== "function" || typeof database.withAccountTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");

  return {
    async findPasswordAccount(email) {
      return database.withAuthenticationTransaction(async (client) => {
        const result = await client.query("SELECT * FROM tideway_private.lookup_password_account($1::citext)", [normalizedEmail(email)]);
        return result.rows[0] || null;
      });
    },

    async findSession(sessionTokenHash) {
      return database.withAuthenticationTransaction(async (client) => {
        const result = await client.query("SELECT * FROM tideway_private.lookup_session($1::bytea)", [tokenHash(sessionTokenHash, "Session token hash")]);
        return result.rows[0] || null;
      });
    },

    async findVerifiedAccountByEmail(email) {
      return database.withAuthenticationTransaction(async (client) => {
        const result = await client.query("SELECT * FROM tideway_private.lookup_verified_email($1::citext)", [normalizedEmail(email)]);
        return result.rows[0] || null;
      });
    },

    async createSession(actor, material, metadata = {}) {
      if (!material || typeof material.expiresAt !== "string") throw new TypeError("Valid session material is required.");
      const userId = uuid(actor?.userId, "Session user id");
      const sessionTokenHash = tokenHash(material.tokenHash, "Session token hash");
      const csrfHash = tokenHash(material.csrfHash, "CSRF token hash");
      const userAgentHash = metadata.userAgentHash == null ? null : tokenHash(metadata.userAgentHash, "User-agent hash");
      const ipHash = metadata.ipHash == null ? null : tokenHash(metadata.ipHash, "IP hash");
      return database.withAccountTransaction(actor, async (client) => {
        const result = await client.query(
          "INSERT INTO sessions (user_id, token_hash, csrf_secret_hash, user_agent_hash, last_ip_hash, expires_at) VALUES ($1::uuid, $2::bytea, $3::bytea, $4::bytea, $5::bytea, $6::timestamptz) RETURNING id, user_id, created_at, expires_at",
          [userId, sessionTokenHash, csrfHash, userAgentHash, ipHash, material.expiresAt]
        );
        return result.rows[0];
      });
    },

    async revokeSession(actor, sessionId) {
      return database.withAccountTransaction(actor, async (client) => {
        const result = await client.query("UPDATE sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1::uuid AND user_id = $2::uuid RETURNING id, revoked_at", [uuid(sessionId, "Session id"), uuid(actor?.userId, "Session user id")]);
        return result.rows[0] || null;
      });
    },

    async revokeAllSessions(actor) {
      return database.withAccountTransaction(actor, async (client) => {
        const result = await client.query("UPDATE sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1::uuid AND revoked_at IS NULL", [uuid(actor?.userId, "Session user id")]);
        return result.rowCount;
      });
    }
  };
}

export { normalizedEmail };

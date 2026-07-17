const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const socialProviders = Object.freeze(["google", "apple", "facebook"]);
const connectableProviders = Object.freeze(["google", "facebook"]);
const accountRoles = Object.freeze(["cleaner", "landlord", "administrator"]);

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

function socialProvider(value) {
  if (!socialProviders.includes(value)) throw new TypeError("A supported social provider is required.");
  return value;
}

function connectableProvider(value) {
  if (!connectableProviders.includes(value)) throw new TypeError("A connectable social provider is required.");
  return value;
}

function boundedProviderText(value, label, maximum, required = true) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if ((required && !normalized) || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) throw new TypeError(`${label} is invalid.`);
  return normalized || null;
}

function normalizedAccountRoles(value) {
  let roles;
  if (Array.isArray(value)) roles = value;
  else if (value === "{}" || value == null) roles = [];
  else if (typeof value === "string" && /^\{(?:cleaner|landlord|administrator)(?:,(?:cleaner|landlord|administrator))*\}$/.test(value)) roles = value.slice(1, -1).split(",");
  else throw new TypeError("The database returned an invalid account role list.");
  if (roles.some((role) => !accountRoles.includes(role))) throw new TypeError("The database returned an unsupported account role.");
  return [...new Set(roles)];
}

function accountResult(record) {
  if (!record || !Object.hasOwn(record, "roles")) return record || null;
  return { ...record, roles: normalizedAccountRoles(record.roles) };
}

export function createAuthenticationRepository(database) {
  if (!database || typeof database.withAuthenticationTransaction !== "function" || typeof database.withAccountTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");

  return {
    async registerPasswordAccount(account) {
      if (!account || typeof account.passwordHash !== "string") throw new TypeError("Password account material is required.");
      const email = normalizedEmail(account.email);
      const displayName = boundedProviderText(account.displayName, "Display name", 120);
      const verificationHash = tokenHash(account.verificationHash, "Verification token hash");
      return database.withAuthenticationTransaction(async (client) => {
        const result = await client.query(
          "SELECT tideway_private.register_password_account($1::citext, $2::text, $3::text, $4::bytea, $5::timestamptz) AS created",
          [email, displayName, account.passwordHash, verificationHash, account.verificationExpiresAt]
        );
        return result.rows[0]?.created === true;
      });
    },

    async consumeEmailVerification(verificationHash) {
      return database.withAuthenticationTransaction(async (client) => {
        const result = await client.query("SELECT * FROM tideway_private.consume_email_verification($1::bytea)", [tokenHash(verificationHash, "Verification token hash")]);
        return result.rows[0] || null;
      });
    },

    async issueEmailVerification(email, verificationHash, verificationExpiresAt) {
      return database.withAuthenticationTransaction(async (client) => {
        const result = await client.query("SELECT tideway_private.issue_email_verification($1::citext, $2::bytea, $3::timestamptz) AS issued", [normalizedEmail(email), tokenHash(verificationHash, "Verification token hash"), verificationExpiresAt]);
        return result.rows[0]?.issued === true;
      });
    },

    async recordPasswordAttempt(userId, succeeded) {
      return database.withAuthenticationTransaction(async (client) => {
        const result = await client.query("SELECT * FROM tideway_private.record_password_attempt($1::uuid, $2::boolean)", [uuid(userId, "Password account user id"), succeeded === true]);
        return result.rows[0] || null;
      });
    },

    async issuePasswordReset(email, resetHash, resetExpiresAt) {
      return database.withAuthenticationTransaction(async (client) => {
        const result = await client.query("SELECT tideway_private.issue_password_reset($1::citext, $2::bytea, $3::timestamptz) AS issued", [normalizedEmail(email), tokenHash(resetHash, "Password reset token hash"), resetExpiresAt]);
        return result.rows[0]?.issued === true;
      });
    },

    async consumePasswordReset(resetHash, replacementPasswordHash) {
      if (typeof replacementPasswordHash !== "string") throw new TypeError("A replacement password hash is required.");
      return database.withAuthenticationTransaction(async (client) => {
        const result = await client.query("SELECT * FROM tideway_private.consume_password_reset($1::bytea, $2::text)", [tokenHash(resetHash, "Password reset token hash"), replacementPasswordHash]);
        return result.rows[0] || null;
      });
    },

    async resolveSocialIdentity(provider, claims) {
      const selectedProvider = socialProvider(provider);
      if (!claims || claims.emailVerified !== true) throw new TypeError("A provider-verified email is required.");
      const subject = boundedProviderText(claims.subject, "Provider subject", 255);
      const email = normalizedEmail(claims.email);
      const displayName = boundedProviderText(claims.displayName, "Provider display name", 120, false);
      const avatarUrl = boundedProviderText(claims.avatarUrl, "Provider avatar URL", 2048, false);
      const profile = claims.profile && typeof claims.profile === "object" && !Array.isArray(claims.profile) ? claims.profile : {};
      if (JSON.stringify(profile).length > 4096) throw new TypeError("Provider profile snapshot is too large.");
      return database.withAuthenticationTransaction(async (client) => {
        const result = await client.query(
          "SELECT * FROM tideway_private.resolve_social_identity($1::authentication_provider, $2::text, $3::citext, $4::boolean, $5::text, $6::text, $7::jsonb)",
          [selectedProvider, subject, email, true, displayName, avatarUrl, profile]
        );
        return accountResult(result.rows[0]);
      });
    },

    async findExistingSocialIdentity(provider, subjectValue) {
      const selectedProvider = socialProvider(provider);
      const subject = boundedProviderText(subjectValue, "Provider subject", 255);
      return database.withAuthenticationTransaction(async (client) => {
        const result = await client.query(
          "SELECT * FROM tideway_private.lookup_existing_social_identity($1::authentication_provider, $2::text)",
          [selectedProvider, subject]
        );
        return accountResult(result.rows[0]);
      });
    },

    async beginPendingSocialIdentity(input) {
      const provider = socialProvider(input?.provider);
      const subject = boundedProviderText(input?.subject, "Provider subject", 255);
      const email = normalizedEmail(input?.email);
      const displayName = boundedProviderText(input?.displayName, "Provider display name", 120, false);
      const avatarUrl = boundedProviderText(input?.avatarUrl, "Provider avatar URL", 2048, false);
      const profile = input?.profile && typeof input.profile === "object" && !Array.isArray(input.profile) ? input.profile : {};
      if (JSON.stringify(profile).length > 4096) throw new TypeError("Provider profile snapshot is too large.");
      const verificationHash = tokenHash(input?.verificationHash, "Social verification token hash");
      return database.withAuthenticationTransaction(async (client) => {
        const result = await client.query(
          "SELECT tideway_private.begin_pending_social_identity($1::authentication_provider, $2::text, $3::citext, $4::text, $5::text, $6::jsonb, $7::bytea, $8::timestamptz) AS state",
          [provider, subject, email, displayName, avatarUrl, profile, verificationHash, input?.expiresAt]
        );
        return result.rows[0]?.state || null;
      });
    },

    async consumePendingSocialIdentity(verificationHash) {
      return database.withAuthenticationTransaction(async (client) => {
        const result = await client.query(
          "SELECT * FROM tideway_private.consume_pending_social_identity($1::bytea)",
          [tokenHash(verificationHash, "Social verification token hash")]
        );
        return accountResult(result.rows[0]);
      });
    },

    async listConnectedIdentities(actor) {
      return database.withAccountTransaction(actor, async (client) => {
        const result = await client.query("SELECT * FROM tideway_private.list_my_authentication_identities()");
        return result.rows;
      });
    },

    async connectSocialIdentity(actor, providerValue, claims) {
      const provider = connectableProvider(providerValue);
      if (!claims || typeof claims.emailVerified !== "boolean") throw new TypeError("Provider connection claims are required.");
      const subject = boundedProviderText(claims.subject, "Provider subject", 255);
      const email = claims.email == null || claims.email === "" ? null : normalizedEmail(claims.email);
      const displayName = boundedProviderText(claims.displayName, "Provider display name", 120, false);
      const avatarUrl = boundedProviderText(claims.avatarUrl, "Provider avatar URL", 2048, false);
      const profile = claims.profile && typeof claims.profile === "object" && !Array.isArray(claims.profile) ? claims.profile : {};
      if (JSON.stringify(profile).length > 4096) throw new TypeError("Provider profile snapshot is too large.");
      return database.withAccountTransaction(actor, async (client) => {
        const result = await client.query(
          "SELECT * FROM tideway_private.connect_social_identity($1::authentication_provider,$2::text,$3::citext,$4::boolean,$5::text,$6::text,$7::jsonb)",
          [provider, subject, email, claims.emailVerified, displayName, avatarUrl, profile]
        );
        return result.rows[0] || null;
      });
    },

    async verifyConnectedSocialIdentity(actor, providerValue, subjectValue) {
      const provider = connectableProvider(providerValue);
      const subject = boundedProviderText(subjectValue, "Provider subject", 255);
      return database.withAccountTransaction(actor, async (client) => {
        const result = await client.query(
          "SELECT tideway_private.verify_my_social_identity($1::authentication_provider,$2::text) AS verified",
          [provider, subject]
        );
        return result.rows[0]?.verified === true;
      });
    },

    async disconnectSocialIdentity(actor, providerValue) {
      const provider = connectableProvider(providerValue);
      return database.withAccountTransaction(actor, async (client) => {
        const result = await client.query(
          "SELECT * FROM tideway_private.disconnect_my_social_identity($1::authentication_provider)",
          [provider]
        );
        return result.rows[0] || null;
      });
    },

    async completeRoleOnboarding(actor, role) {
      if (!actor) throw new TypeError("An authenticated account is required.");
      if (role !== "cleaner" && role !== "landlord") throw new TypeError("Onboarding role must be Cleaner or Landlord.");
      return database.withAccountTransaction(actor, async (client) => {
        const result = await client.query("SELECT * FROM tideway_private.complete_role_onboarding($1::user_role)", [role]);
        return accountResult(result.rows[0]);
      });
    },

    async activateWorkspace(actor, role) {
      if (!actor) throw new TypeError("An authenticated account is required.");
      if (role !== "cleaner" && role !== "landlord") throw new TypeError("Workspace role must be Cleaner or Landlord.");
      return database.withAccountTransaction(actor, async (client) => {
        const result = await client.query("SELECT * FROM tideway_private.activate_my_workspace($1::user_role)", [role]);
        return accountResult(result.rows[0]);
      });
    },

    async findPasswordAccount(email) {
      return database.withAuthenticationTransaction(async (client) => {
        const result = await client.query("SELECT * FROM tideway_private.lookup_password_account($1::citext)", [normalizedEmail(email)]);
        return accountResult(result.rows[0]);
      });
    },

    async findSession(sessionTokenHash) {
      return database.withAuthenticationTransaction(async (client) => {
        const result = await client.query("SELECT * FROM tideway_private.lookup_session($1::bytea)", [tokenHash(sessionTokenHash, "Session token hash")]);
        return accountResult(result.rows[0]);
      });
    },

    async findVerifiedAccountByEmail(email) {
      return database.withAuthenticationTransaction(async (client) => {
        const result = await client.query("SELECT * FROM tideway_private.lookup_verified_email($1::citext)", [normalizedEmail(email)]);
        return accountResult(result.rows[0]);
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

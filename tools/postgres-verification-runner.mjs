import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(toolPath), "..");
const defaultScriptPath = path.join(projectRoot, "db", "integration", "deployment-verification.sql");
const allowedSslModes = new Set(["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]);
const allowedParameters = new Set(["sslmode", "sslrootcert", "connect_timeout"]);
const inheritedEnvironmentNames = Object.freeze([
  "PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "ComSpec", "TEMP", "TMP",
  "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "LANG", "LC_ALL"
]);

function decoded(value, label) {
  try { return decodeURIComponent(value); } catch { throw new TypeError(`${label} contains invalid URL encoding.`); }
}

export function postgresVerificationEnvironment(connectionUrl, baseEnvironment = process.env) {
  if (typeof connectionUrl !== "string" || !connectionUrl.trim()) throw new TypeError("DATABASE_VERIFICATION_URL is required.");
  let parsed;
  try { parsed = new URL(connectionUrl.trim()); } catch { throw new TypeError("DATABASE_VERIFICATION_URL must be a valid PostgreSQL URL."); }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new TypeError("DATABASE_VERIFICATION_URL must use PostgreSQL.");
  if (!parsed.hostname || !parsed.username) throw new TypeError("DATABASE_VERIFICATION_URL must include a host and migration-owner username.");
  if (!parsed.pathname || parsed.pathname === "/" || parsed.pathname.slice(1).includes("/")) throw new TypeError("DATABASE_VERIFICATION_URL must name one database.");
  for (const key of parsed.searchParams.keys()) if (!allowedParameters.has(key)) throw new TypeError(`Unsupported PostgreSQL URL parameter: ${key}.`);

  const remote = !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase());
  const sslMode = parsed.searchParams.get("sslmode") || (remote ? "verify-full" : "prefer");
  if (!allowedSslModes.has(sslMode)) throw new TypeError("DATABASE_VERIFICATION_URL contains an unsupported sslmode.");
  const connectTimeout = parsed.searchParams.get("connect_timeout") || "5";
  if (!/^\d{1,2}$/.test(connectTimeout) || Number(connectTimeout) < 1 || Number(connectTimeout) > 60) throw new TypeError("PostgreSQL connect_timeout must be between 1 and 60 seconds.");

  const environment = {};
  for (const name of inheritedEnvironmentNames) {
    if (Object.hasOwn(baseEnvironment, name) && typeof baseEnvironment[name] === "string") environment[name] = baseEnvironment[name];
  }
  Object.assign(environment, {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGDATABASE: decoded(parsed.pathname.slice(1), "Database name"),
    PGUSER: decoded(parsed.username, "Database username"),
    PGPASSWORD: decoded(parsed.password, "Database password"),
    PGSSLMODE: sslMode,
    PGCONNECT_TIMEOUT: connectTimeout,
    PGAPPNAME: "tideway-deployment-verifier"
  });
  if (parsed.searchParams.has("sslrootcert")) environment.PGSSLROOTCERT = parsed.searchParams.get("sslrootcert");

  return Object.freeze({
    environment: Object.freeze(environment),
    summary: Object.freeze({ host: parsed.hostname, port: environment.PGPORT, database: environment.PGDATABASE, user: environment.PGUSER, sslMode })
  });
}

export function sanitizePostgresOutput(value) {
  return String(value || "").replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[database-url-redacted]").slice(-8000);
}

export function runPostgresDeploymentVerification(options = {}) {
  const connectionUrl = options.connectionUrl ?? process.env.DATABASE_VERIFICATION_URL;
  const psqlCommand = options.psqlCommand || "psql";
  const scriptPath = path.resolve(options.scriptPath || defaultScriptPath);
  const spawn = options.spawn || spawnSync;
  const prepared = postgresVerificationEnvironment(connectionUrl, options.baseEnvironment || process.env);
  const args = ["-X", "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--file", scriptPath];
  const result = spawn(psqlCommand, args, { encoding: "utf8", windowsHide: true, env: prepared.environment });
  if (result?.error?.code === "ENOENT") throw new Error("PostgreSQL verification requires the psql client, which is not installed or not on PATH.");
  if (result?.error) throw new Error("PostgreSQL verification could not start the psql client.");
  if (result?.status !== 0) {
    const error = new Error("PostgreSQL deployment verification failed.");
    error.verificationOutput = sanitizePostgresOutput(`${result?.stdout || ""}\n${result?.stderr || ""}`);
    throw error;
  }
  return Object.freeze({ ...prepared.summary, output: sanitizePostgresOutput(result.stdout), scriptPath });
}

if (process.argv[1] && path.resolve(process.argv[1]) === toolPath) {
  try {
    const result = runPostgresDeploymentVerification();
    console.log(`PostgreSQL deployment verified for ${result.database} on ${result.host}:${result.port} using ${result.sslMode}.`);
    if (result.output.trim()) console.log(result.output.trim());
  } catch (error) {
    console.error(error.message);
    if (error.verificationOutput) console.error(error.verificationOutput.trim());
    process.exitCode = 1;
  }
}

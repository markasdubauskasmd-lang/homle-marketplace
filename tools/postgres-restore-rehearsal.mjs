import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { execFile } from "node:child_process";
import { mkdtemp, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "pg";

const executeFile = promisify(execFile);
let phase = "configuration";
let mismatch = null;
const sourceName = "ci_tideway_test";
const targetName = "ci_tideway_restore_test";
const fixtureSchema = "codex_restore_rehearsal";
const fixtureIds = ["7f900000-0000-4000-8000-000000000001", "7f900000-0000-4000-8000-000000000002"];
const fixtureEmails = ["restore-owner@invalid.example", "restore-other@invalid.example"];
const schemas = ["public", "tideway_private", fixtureSchema];
const quote = value => '"' + String(value).replaceAll('"', '""') + '"';

export function validateRestoreEnvironment(env) {
  assert.equal(env.TIDEWAY_DATABASE_TEST_CONFIRMATION, "RUN TIDEWAY DISPOSABLE DATABASE TESTS", "Disposable database confirmation is required");
  const result = {};
  for (const [key, variable, role, database] of [
    ["owner", "DATABASE_INTEGRATION_OWNER_URL", "tideway_owner", sourceName],
    ["app", "DATABASE_INTEGRATION_APP_URL", "tideway_app", sourceName],
    ["worker", "DATABASE_INTEGRATION_WORKER_URL", "tideway_worker", sourceName],
    ["admin", "DATABASE_RESTORE_ADMIN_URL", "postgres", "postgres"]
  ]) {
    let url;
    try { url = new URL(env[variable]); } catch { throw new Error("Restore rehearsal connection configuration is invalid"); }
    assert(["postgres:", "postgresql:"].includes(url.protocol), "PostgreSQL connections required");
    assert.equal(url.hostname, "localhost", "Restore rehearsal accepts localhost only");
    assert.equal(url.pathname, "/" + database, "Restore rehearsal database is not allowlisted");
    assert.equal(decodeURIComponent(url.username), role, "Restore rehearsal role is not allowlisted");
    assert.equal(url.search, "", "Connection overrides are forbidden");
    assert.equal(url.hash, "", "Connection fragments are forbidden");
    assert(url.password.length > 0, "Explicit disposable credentials are required");
    result[key] = url;
  }
  assert(new Set(Object.values(result).map(url => url.port || "5432")).size === 1, "All connections must use the same disposable cluster");
  return result;
}

function client(url, database) {
  const selected = new URL(url);
  if (database) selected.pathname = "/" + database;
  return new Client({ connectionString: selected.toString(), connectionTimeoutMillis: 10000, statement_timeout: 30000, application_name: "disposable-restore-rehearsal" });
}

function binaryEnvironment(admin) {
  return { PATH: process.env.PATH || "", ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    PGHOST: "localhost", PGPORT: admin.port || "5432", PGUSER: "postgres", PGPASSWORD: decodeURIComponent(admin.password),
    PGCONNECT_TIMEOUT: "10", PGCLIENTENCODING: "UTF8", LC_ALL: "C" };
}

async function command(binary, args, env) {
  try { return await executeFile(binary, args, { env, timeout: 180000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }); }
  catch { throw new Error("Disposable restore command failed: " + binary); }
}

async function assertRole(connection, expected, database, privileged = false) {
  const row = (await connection.query("SELECT current_user AS role,current_database() AS database,rolsuper,rolbypassrls,current_setting('server_version_num')::int AS version FROM pg_roles WHERE rolname=current_user")).rows[0];
  assert.equal(row.role, expected);
  assert.equal(row.database, database);
  assert.equal(Math.floor(row.version / 10000), 16, "The rehearsal requires PostgreSQL16");
  assert.equal(row.rolsuper, privileged);
  assert.equal(row.rolbypassrls, privileged);
  await connection.query("SET timezone='UTC'; SET datestyle='ISO, YMD'; SET intervalstyle='postgres'");
}

function canonicalAcl(expression) {
  return `(SELECT COALESCE(jsonb_agg(jsonb_build_object('grantor',grantor.rolname,'grantee',CASE WHEN acl_entry.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,'privilege',acl_entry.privilege_type,'grantable',acl_entry.is_grantable) ORDER BY grantor.rolname,CASE WHEN acl_entry.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,acl_entry.privilege_type,acl_entry.is_grantable),'[]'::jsonb) FROM aclexplode(${expression}) acl_entry LEFT JOIN pg_roles grantor ON grantor.oid=acl_entry.grantor LEFT JOIN pg_roles grantee ON grantee.oid=acl_entry.grantee)`;
}

async function snapshot(connection) {
  const relations = (await connection.query(`SELECT n.nspname AS schema,c.relname AS name,c.relkind,c.relrowsecurity,c.relforcerowsecurity,
    pg_get_userbyid(c.relowner) AS owner,${canonicalAcl("COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::\"char\" ELSE 'r'::\"char\" END,c.relowner))")} AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=ANY($1::text[]) AND c.relkind IN ('r','p','S','v','m') ORDER BY n.nspname,c.relname`, [schemas])).rows;
  const data = [];
  for (const relation of relations) {
    const qualified = quote(relation.schema) + "." + quote(relation.name);
    if (["r", "p"].includes(relation.relkind)) {
      const row = (await connection.query(`SELECT count(*)::text AS count,encode(digest(COALESCE(string_agg(to_jsonb(record)::text,E'\\n' ORDER BY to_jsonb(record)::text),''),'sha256'),'hex') AS hash FROM ${qualified} record`)).rows[0];
      data.push({ schema: relation.schema, name: relation.name, ...row });
    } else if (relation.relkind === "S") {
      data.push({ schema: relation.schema, name: relation.name, ...(await connection.query(`SELECT last_value::text,is_called FROM ${qualified}`)).rows[0] });
    }
  }
  const functions = (await connection.query(`SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
    pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,${canonicalAcl("COALESCE(p.proacl,acldefault('f',p.proowner))")} AS acl,pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1::text[]) AND p.prokind IN ('f','p') ORDER BY n.nspname,p.proname,arguments`, [schemas])).rows;
  const policies = (await connection.query("SELECT * FROM pg_policies WHERE schemaname=ANY($1::text[]) ORDER BY schemaname,tablename,policyname", [schemas])).rows;
  const schemaGrants = (await connection.query(`SELECT nspname,pg_get_userbyid(nspowner) AS owner,${canonicalAcl("COALESCE(nspacl,acldefault('n',nspowner))")} AS acl FROM pg_namespace WHERE nspname=ANY($1::text[]) ORDER BY nspname`, [schemas])).rows;
  const extensions = (await connection.query("SELECT extname,extversion,pg_get_userbyid(extowner) AS owner FROM pg_extension ORDER BY extname")).rows;
  const columns = (await connection.query(`SELECT n.nspname AS schema,c.relname AS relation,a.attnum,a.attname,
    format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,${canonicalAcl("COALESCE(a.attacl,'{}'::aclitem[])")} AS acl,
    pg_get_expr(d.adbin,d.adrelid) AS default_expression
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m')
    ORDER BY n.nspname,c.relname,a.attnum`, [schemas])).rows;
  const constraints = (await connection.query(`SELECT n.nspname AS schema,c.conname,c.contype,c.condeferrable,c.condeferred,c.convalidated,
    r.relname AS relation,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
    JOIN pg_namespace n ON n.oid=c.connamespace LEFT JOIN pg_class r ON r.oid=c.conrelid
    WHERE n.nspname=ANY($1::text[]) ORDER BY n.nspname,r.relname,c.conname`, [schemas])).rows;
  const indexes = (await connection.query(`SELECT n.nspname AS schema,r.relname AS relation,i.relname AS name,
    x.indisvalid,x.indisready,pg_get_indexdef(i.oid) AS definition
    FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class r ON r.oid=x.indrelid
    JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname=ANY($1::text[]) ORDER BY n.nspname,r.relname,i.relname`, [schemas])).rows;
  const triggers = (await connection.query(`SELECT n.nspname AS schema,c.relname AS relation,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=ANY($1::text[]) AND NOT t.tgisinternal ORDER BY n.nspname,c.relname,t.tgname`, [schemas])).rows;
  const views = (await connection.query(`SELECT n.nspname AS schema,c.relname,c.relkind,pg_get_viewdef(c.oid) AS definition
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=ANY($1::text[]) AND c.relkind IN ('v','m') ORDER BY n.nspname,c.relname`, [schemas])).rows;
  const defaultPrivileges = (await connection.query(`SELECT owner.rolname AS owner,n.nspname AS schema,d.defaclobjtype,
    jsonb_agg(jsonb_build_object('grantor',grantor.rolname,'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,
      'privilege',a.privilege_type,'grantable',a.is_grantable)
      ORDER BY grantor.rolname,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,a.privilege_type,a.is_grantable) AS privileges
    FROM pg_default_acl d JOIN pg_roles owner ON owner.oid=d.defaclrole LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a LEFT JOIN pg_roles grantor ON grantor.oid=a.grantor LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee
    GROUP BY owner.rolname,n.nspname,d.defaclobjtype ORDER BY owner.rolname,n.nspname,d.defaclobjtype`)).rows;
  return { relations, data, functions, policies, schemaGrants, extensions, columns, constraints, indexes, triggers, views, defaultPrivileges };
}

function compareSnapshots(actual, expected) {
  for (const category of Object.keys(expected)) {
    if (isDeepStrictEqual(actual[category], expected[category])) continue;
    const index = expected[category].findIndex((row, i) => !isDeepStrictEqual(actual[category][i], row));
    const left = actual[category][index], right = expected[category][index];
    mismatch = { category, actualCount: actual[category].length, expectedCount: expected[category].length, index,
      fields: [...new Set([...Object.keys(left || {}), ...Object.keys(right || {})])].filter(key => !isDeepStrictEqual(left?.[key], right?.[key])) };
    throw new Error('Restore catalog/data mismatch');
  }
}

async function mustDeny(connection, sql, values = []) {
  await connection.query("BEGIN");
  let denied = false;
  try { await connection.query(sql, values); } catch (error) { denied = error.code === "42501"; }
  finally { await connection.query("ROLLBACK"); }
  assert(denied, "Restored runtime permissions did not deny a forbidden operation");
}

export async function runRestoreRehearsal(env = process.env) {
  const urls = validateRestoreEnvironment(env);
  const binaryEnv = binaryEnvironment(urls.admin);
  phase = "binary-version";
  for (const binary of ["pg_dump", "pg_restore"]) {
    const version = await command(binary, ["--version"], binaryEnv);
    assert(/\(PostgreSQL\) 16\./.test(version.stdout), "PostgreSQL16 dump/restore binaries are required");
  }
  const admin = client(urls.admin), source = client(urls.owner), sourceReader = client(urls.admin, sourceName);
  const connections = [];
  let sourceSeeded = false, directory, dumpPath;
  try {
    phase = "connection-and-target-guards";
    await admin.connect(); connections.push(admin); await assertRole(admin, "postgres", "postgres", true);
    assert.equal((await admin.query("SELECT count(*)::int AS count FROM pg_database WHERE datname=$1", [targetName])).rows[0].count, 0, "Existing restore destination refused");
    await source.connect(); connections.push(source); await assertRole(source, "tideway_owner", sourceName);
    assert.equal((await source.query("SELECT count(*)::int AS count FROM users WHERE id=ANY($1::uuid[]) OR email=ANY($2::citext[])", [fixtureIds, fixtureEmails])).rows[0].count, 0, "Existing restore fixture accounts refused");
    assert.equal((await source.query("SELECT to_regnamespace($1) AS schema", [fixtureSchema])).rows[0].schema, null, "Existing restore fixture schema refused");
    assert((await source.query("SELECT to_regprocedure('tideway_private.claim_request_photo_terminal_cleanup(integer)') AS function")).rows[0].function, "Source must include media migration116");
    phase = "synthetic-source-seed";
    await source.query("BEGIN");
    await source.query(`CREATE SCHEMA ${fixtureSchema}; CREATE TABLE ${fixtureSchema}.payloads(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,owner_id uuid NOT NULL REFERENCES public.users(id),payload jsonb NOT NULL,bytes bytea,note text)`);
    await source.query("INSERT INTO users(id,email,display_name,selected_role) VALUES($1,$2,'Restore synthetic owner','landlord'),($3,$4,'Restore synthetic other','landlord')", [fixtureIds[0], fixtureEmails[0], fixtureIds[1], fixtureEmails[1]]);
    await source.query("INSERT INTO user_roles(user_id,role) VALUES($1,'landlord'),($2,'landlord')", fixtureIds);
    await source.query(`INSERT INTO ${fixtureSchema}.payloads(owner_id,payload,bytes,note) VALUES($1,$2::jsonb,decode('0001feff','hex'),'Synthetic café — restore'),($3,'{"nested":[true,null,3.25]}'::jsonb,NULL,NULL)`, [fixtureIds[0], JSON.stringify({ synthetic: true, exactPence: 12345 }), fixtureIds[1]]);
    await source.query("COMMIT"); sourceSeeded = true;
    // Hold an exported snapshot so pg_dump and all source fingerprints observe
    // the same committed data. No production connection or object storage used.
    phase = "source-snapshot";
    await sourceReader.connect(); connections.push(sourceReader); await assertRole(sourceReader, "postgres", sourceName, true);
    await sourceReader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const exported = (await sourceReader.query("SELECT pg_export_snapshot() AS snapshot")).rows[0].snapshot;
    const before = await snapshot(sourceReader);
    directory = await mkdtemp(path.join(tmpdir(), "homlle-restore-ci-"));
    dumpPath = path.join(directory, "source.dump");
    phase = "dump";
    await command("pg_dump", ["--format=custom", "--file", dumpPath, "--snapshot", exported, "--dbname", sourceName], binaryEnv);
    await sourceReader.query("ROLLBACK");
    phase = "create-disposable-destination";
    await admin.query(`CREATE DATABASE ${quote(targetName)} OWNER tideway_owner TEMPLATE template0`);
    // Ownership, ACLs and SECURITY DEFINER owners must be restored verbatim.
    phase = "restore";
    await command("pg_restore", ["--exit-on-error", "--single-transaction", "--dbname", targetName, dumpPath], binaryEnv);
    phase = "restored-snapshot";
    const restored = client(urls.owner, targetName);
    await restored.connect(); connections.push(restored); await assertRole(restored, "tideway_owner", targetName);
    const restoredReader = client(urls.admin, targetName);
    await restoredReader.connect(); connections.push(restoredReader); await assertRole(restoredReader, "postgres", targetName, true);
    compareSnapshots(await snapshot(restoredReader), before);
    phase = "source-unchanged";
    compareSnapshots(await snapshot(sourceReader), before);
    phase = "corruption-detector";
    await restoredReader.query("BEGIN");
    try {
      await restoredReader.query(`UPDATE ${fixtureSchema}.payloads SET payload=payload || '{"restore_probe":true}'::jsonb WHERE id=1`);
      const corrupted = await snapshot(restoredReader);
      assert.throws(() => compareSnapshots(corrupted, before), "Changed restored records must fail verification");
      assert.equal(mismatch?.category, "data");
    } finally { await restoredReader.query("ROLLBACK"); mismatch = null; }
    phase = "permission-expansion-detector";
    await restoredReader.query("BEGIN");
    try {
      await restoredReader.query(`GRANT SELECT ON ${fixtureSchema}.payloads TO tideway_app`);
      const expanded = await snapshot(restoredReader);
      assert.throws(() => compareSnapshots(expanded, before), "Expanded restored permissions must fail verification");
      assert.equal(mismatch?.category, "relations");
    } finally { await restoredReader.query("ROLLBACK"); mismatch = null; }
    compareSnapshots(await snapshot(restoredReader), before);
    phase = "restored-runtime-permissions";
    const app = client(urls.app, targetName), worker = client(urls.worker, targetName);
    await app.connect(); connections.push(app); await assertRole(app, "tideway_app", targetName);
    await worker.connect(); connections.push(worker); await assertRole(worker, "tideway_worker", targetName);
    await app.query("BEGIN");
    await app.query("SELECT set_config('app.user_id',$1,true),set_config('app.user_roles','landlord',true)", [fixtureIds[0]]);
    assert.deepEqual((await app.query("SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id", [fixtureIds])).rows.map(row => row.id), [fixtureIds[0]], "Restored real user RLS leaked the other account");
    await app.query("ROLLBACK");
    await mustDeny(app, "SELECT * FROM tideway_private.claim_request_photo_terminal_cleanup(1)");
    await mustDeny(worker, "SELECT * FROM users LIMIT 1");
    await worker.query("BEGIN");
    await worker.query("SELECT * FROM tideway_private.claim_request_photo_terminal_cleanup(1)");
    await worker.query("ROLLBACK");
    return { verified: true, source: sourceName, destination: targetName, tableSnapshots: before.data.length,
      functionSnapshots: before.functions.length, policySnapshots: before.policies.length, restoredAppRls: true, restoredWorkerBoundary: true,
      corruptionDetection: true, permissionExpansionDetection: true, productionBackupVerified: false, objectStorageRestored: false };
  } finally {
    // Cleanup only fixture objects/accounts created by this run in the exact
    // allowlisted source. Never drop or replace an existing database.
    try {
      if (connections.includes(sourceReader)) await sourceReader.query("ROLLBACK");
      if (connections.includes(source)) {
        await source.query("ROLLBACK");
        if (sourceSeeded) {
          await source.query("BEGIN");
          await source.query(`DROP TABLE ${fixtureSchema}.payloads; DROP SCHEMA ${fixtureSchema}`);
          await source.query("DELETE FROM users WHERE id=ANY($1::uuid[]) AND email=ANY($2::citext[])", [fixtureIds, fixtureEmails]);
          await source.query("COMMIT");
        }
      }
    } finally {
      await Promise.allSettled(connections.map(connection => connection.end()));
      if (dumpPath) {
        assert.equal(path.dirname(path.resolve(dumpPath)), path.resolve(directory));
        assert(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep));
        assert(path.basename(directory).startsWith("homlle-restore-ci-"));
        try { await unlink(dumpPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      if (directory) await rmdir(directory);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runRestoreRehearsal())); }
  catch { console.error("Disposable PostgreSQL restore rehearsal failed at " + phase + "; no production restore was attempted. No credentials or row data logged."); if (mismatch) console.error(JSON.stringify(mismatch)); process.exitCode = 1; }
}

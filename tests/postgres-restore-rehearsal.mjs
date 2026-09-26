import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {validateRestoreEnvironment} from '../tools/postgres-restore-rehearsal.mjs';
const secret='restore-rehearsal-do-not-print-this';
const baseline={...process.env,TIDEWAY_DATABASE_TEST_CONFIRMATION:'RUN TIDEWAY DISPOSABLE DATABASE TESTS',DATABASE_INTEGRATION_OWNER_URL:'postgresql://tideway_owner:'+secret+'@localhost:5432/ci_tideway_test',DATABASE_INTEGRATION_APP_URL:'postgresql://tideway_app:'+secret+'@localhost:5432/ci_tideway_test',DATABASE_INTEGRATION_WORKER_URL:'postgresql://tideway_worker:'+secret+'@localhost:5432/ci_tideway_test',DATABASE_RESTORE_ADMIN_URL:'postgresql://postgres:'+secret+'@localhost:5432/postgres'};
const cases=[
 ['missing confirmation',{TIDEWAY_DATABASE_TEST_CONFIRMATION:''}],
 ['remote source',{DATABASE_INTEGRATION_OWNER_URL:baseline.DATABASE_INTEGRATION_OWNER_URL.replace('localhost','database.example.invalid')}],
 ['production database',{DATABASE_INTEGRATION_OWNER_URL:baseline.DATABASE_INTEGRATION_OWNER_URL.replace('ci_tideway_test','production')}],
 ['wrong owner',{DATABASE_INTEGRATION_OWNER_URL:baseline.DATABASE_INTEGRATION_OWNER_URL.replace('tideway_owner','postgres')}],
 ['wrong runtime role',{DATABASE_INTEGRATION_APP_URL:baseline.DATABASE_INTEGRATION_APP_URL.replace('tideway_app','tideway_owner')}],
 ['wrong worker role',{DATABASE_INTEGRATION_WORKER_URL:baseline.DATABASE_INTEGRATION_WORKER_URL.replace('tideway_worker','tideway_owner')}],
 ['remote admin',{DATABASE_RESTORE_ADMIN_URL:baseline.DATABASE_RESTORE_ADMIN_URL.replace('localhost','database.example.invalid')}],
 ['wrong admin database',{DATABASE_RESTORE_ADMIN_URL:baseline.DATABASE_RESTORE_ADMIN_URL.replace('/postgres','/production')}],
 ['mismatched port',{DATABASE_INTEGRATION_APP_URL:baseline.DATABASE_INTEGRATION_APP_URL.replace(':5432/',':5433/')}],
 ['query override',{DATABASE_INTEGRATION_OWNER_URL:baseline.DATABASE_INTEGRATION_OWNER_URL+'?host=database.example.invalid'}],
 ['fragment override',{DATABASE_RESTORE_ADMIN_URL:baseline.DATABASE_RESTORE_ADMIN_URL+'#unexpected'}],
 ['malformed URL',{DATABASE_INTEGRATION_OWNER_URL:'malformed-'+secret}],
];
assert.equal(Object.keys(validateRestoreEnvironment(baseline)).length,4);
for(const [name,changes] of cases){
 assert.throws(()=>validateRestoreEnvironment({...baseline,...changes}),undefined,name+' must be rejected by pre-connection validation');
 const result=spawnSync(process.execPath,['tools/postgres-restore-rehearsal.mjs'],{env:{...baseline,...changes},encoding:'utf8',timeout:5000});
 assert.ifError(result.error);
 assert.equal(result.status,1,name+' must fail closed before connecting');
 const output=result.stdout+result.stderr;
 assert.ok(!output.includes(secret),name+' leaked a credential');
 assert.ok(!/ECONNREFUSED|ENOTFOUND|password authentication failed|pg_dump.*not found/.test(output),name+' reached external execution instead of the guard');
 assert.match(output,/restore|disposable|confirmation|invalid|local/i,name+' must explain the safety guard');
}
console.log('Restore rehearsal safety passed: explicit confirmation, local disposable databases, role/port boundaries, URL overrides and credential-safe failures.');

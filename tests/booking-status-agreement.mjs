import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { bookingStatuses, taskStatuses } from "../src/marketplace/domain.mjs";

// PostgreSQL is the source of truth for a booking's status: the column is an enum, so a
// value the database has never heard of cannot be written whatever the JavaScript
// believes. The risk runs the other way — the enum gains a status and the JavaScript
// keeps rejecting it, or a status is retired in the domain and the enum still allows
// rows to hold it.
//
// `booking-workflow` and `administrator-booking-service` each used to restate all twelve
// values inline. They agreed with `domain.mjs` when this was written, so nothing was
// broken, but adding a status meant editing four places with nothing to enforce it. Both
// now build their Set from the canonical export; this pins the remaining edge, between
// the canonical export and the database.

const migrations = readdirSync(new URL("../db/migrations", import.meta.url)).filter((name) => name.endsWith(".sql")).sort();
const sql = migrations.map((name) => readFileSync(new URL(`../db/migrations/${name}`, import.meta.url), "utf8")).join("\n");

function enumValues(typeName) {
  // The declaration, plus any later ALTER TYPE ... ADD VALUE, so a status added by a
  // follow-up migration counts.
  const declared = sql.match(new RegExp(`CREATE TYPE ${typeName} AS ENUM \(([^)]*)\)`));
  assert.ok(declared, `No CREATE TYPE ${typeName} found in db/migrations. The database no longer constrains this column to a known set.`);
  const values = [...declared[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  for (const added of sql.matchAll(new RegExp(`ALTER TYPE ${typeName} ADD VALUE[^;]*?'([^']+)'`, "g"))) values.push(added[1]);
  return values;
}

for (const [typeName, exported, label] of [
  ["booking_status", bookingStatuses, "booking statuses"],
  ["cleaning_task_status", taskStatuses, "cleaning task statuses"]
]) {
  const inDatabase = enumValues(typeName);
  const missingFromCode = inDatabase.filter((value) => !exported.includes(value));
  const missingFromDatabase = [...exported].filter((value) => !inDatabase.includes(value));
  assert.deepEqual(missingFromCode, [], `The database allows ${label} that src/marketplace/domain.mjs does not: ${missingFromCode.join(", ")}. Rows can hold a value the application will reject, so a real booking becomes unreadable.`);
  assert.deepEqual(missingFromDatabase, [], `src/marketplace/domain.mjs lists ${label} the database enum will not accept: ${missingFromDatabase.join(", ")}. Writing one fails at the database with an opaque error.`);
}

/* ── The two services must not restate the list again ── */

for (const name of ["booking-workflow", "administrator-booking-service"]) {
  const source = readFileSync(new URL(`../src/marketplace/${name}.mjs`, import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /const bookingStatuses = new Set\(\[/,
    `${name}.mjs has gone back to restating every booking status inline. It agreed with domain.mjs last time and still drifted out of anyone's attention — build the Set from the canonical export instead.`
  );
  assert.match(source, /canonicalBookingStatuses/, `${name}.mjs no longer derives its accepted booking statuses from domain.mjs.`);
}

console.log(`Booking status agreement tests passed: all ${bookingStatuses.length} booking statuses and ${taskStatuses.length} task statuses match the PostgreSQL enums exactly, and neither service restates the list.`);

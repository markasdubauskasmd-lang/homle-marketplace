// Guard against the defect class that made email verification and password
// reset impossible for the whole of the product's life.
//
// A PL/pgSQL function declared `RETURNS TABLE (user_id uuid, ...)` gets an OUT
// parameter for every named column, and those names are in scope for the entire
// body. An unqualified `WHERE user_id = ...` inside such a function is then
// ambiguous between the OUT parameter and the table column, and PostgreSQL
// raises `column reference "user_id" is ambiguous` the first time that
// statement runs — at runtime, in production, with a 500 to the customer.
//
// Nothing caught that: the suite asserted only that the migration text
// *mentioned* the function names, and the service tests ran against a fake
// repository, so the SQL was never executed. This check needs no database and
// runs on every push.
//
// Only predicate positions are examined. The left-hand side of a SET or
// ON CONFLICT DO UPDATE SET clause is always resolved as a column by
// PostgreSQL and is never ambiguous, so flagging those would be noise.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationDirectory = path.join(projectRoot, "db", "migrations");

const functionHeader = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z_][\w.]*)\s*\(/gi;

/** The body between the dollar-quote that opens after a function header. */
function functionBodyAt(sql, headerIndex) {
  const opener = /\$([A-Za-z_]\w*)?\$/g;
  opener.lastIndex = headerIndex;
  const open = opener.exec(sql);
  if (!open) return null;
  const closeIndex = sql.indexOf(open[0], open.index + open[0].length);
  if (closeIndex === -1) return null;
  return { body: sql.slice(open.index + open[0].length, closeIndex), end: closeIndex };
}

/** The column names in `RETURNS TABLE (...)`, or [] when there is no such clause. */
function returnsTableColumns(signature) {
  const match = /RETURNS\s+TABLE\s*\(/i.exec(signature);
  if (!match) return [];
  let depth = 0;
  let start = -1;
  for (let index = match.index + match[0].length - 1; index < signature.length; index += 1) {
    const character = signature[index];
    if (character === "(") { if (depth === 0) start = index + 1; depth += 1; }
    else if (character === ")") { depth -= 1; if (depth === 0) return splitColumns(signature.slice(start, index)); }
  }
  return [];
}

function splitColumns(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const character of text) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) { parts.push(current); current = ""; continue; }
    current += character;
  }
  parts.push(current);
  return parts.map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
}

// Later migrations replace earlier definitions, so only the last definition of
// each function is the one the database actually runs.
const effective = new Map();
for (const file of readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).sort()) {
  const sql = readFileSync(path.join(migrationDirectory, file), "utf8");
  functionHeader.lastIndex = 0;
  let header;
  while ((header = functionHeader.exec(sql)) !== null) {
    const located = functionBodyAt(sql, header.index);
    if (!located) continue;
    const signature = sql.slice(header.index, sql.indexOf("$", header.index));
    effective.set(header[1].toLowerCase(), { file, signature, body: located.body });
    functionHeader.lastIndex = located.end;
  }
}

assert.ok(effective.size > 50, `expected the migration set to define many functions, found ${effective.size}`);

const offences = [];
for (const [name, definition] of effective) {
  const columns = returnsTableColumns(definition.signature);
  for (const column of columns) {
    const predicate = new RegExp(`\\b(?:WHERE|AND|OR|ON)\\s+(${column})\\s*(?:=|<>|!=|>=|<=|>|<|IS\\b|IN\\b|LIKE\\b)`, "gi");
    let hit;
    while ((hit = predicate.exec(definition.body)) !== null) {
      const start = Math.max(0, hit.index - 70);
      offences.push(`${definition.file}: ${name}() references OUT parameter "${column}" unqualified in a predicate — ...${definition.body.slice(start, hit.index + 60).replace(/\s+/g, " ").trim()}`);
    }
  }
}

assert.deepEqual(
  offences,
  [],
  `PL/pgSQL functions returning a table must qualify every column reference against a table alias, or PostgreSQL rejects the statement at runtime as ambiguous:\n${offences.join("\n")}`
);

console.log(`PL/pgSQL column-resolution checks passed: ${effective.size} effective function definitions, no ambiguous OUT-parameter reference.`);

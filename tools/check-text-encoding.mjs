import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [path.join(root, "server.mjs")];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(target);
    else if (/\.(?:css|html|js|json|mjs)$/i.test(entry.name)) files.push(target);
  }
}

await collect(path.join(root, "public"));
const suspicious = ["â€", "Â", "Ã"];
const failures = [];
for (const file of files) {
  const contents = await readFile(file, "utf8");
  contents.split(/\r?\n/).forEach((line, index) => {
    if (suspicious.some((token) => line.includes(token))) failures.push(`${path.relative(root, file)}:${index + 1}`);
  });
}

if (failures.length) {
  throw new Error(`Possible mojibake found at ${failures.join(", ")}. Save the intended punctuation as UTF-8.`);
}

console.log(`Text encoding guard passed (${files.length} shipped source files).`);

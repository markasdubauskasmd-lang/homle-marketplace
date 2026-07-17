import { stdin, stdout } from "node:process";
import { stagingAccountEmailSha256 } from "../src/marketplace/staging-account-access.mjs";

if (process.argv.length !== 2) throw new TypeError("Pipe one staging email to this tool; command-line email arguments are refused.");

stdin.setEncoding("utf8");
let input = "";
for await (const chunk of stdin) {
  input += chunk;
  if (input.length > 512) throw new TypeError("Staging email input is too large.");
}

stdout.write(`${stagingAccountEmailSha256(input)}\n`);

#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authenticationActivationReadiness } from "../authentication-activation-readiness.mjs";
import { loadReleaseIdentity } from "../release-identity.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseIdentity = await loadReleaseIdentity({ projectRoot });
const result = authenticationActivationReadiness(process.env, { projectRoot, releaseIdentity });
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

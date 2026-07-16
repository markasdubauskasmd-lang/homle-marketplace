#!/usr/bin/env node
import { authenticationActivationReadiness } from "../authentication-activation-readiness.mjs";

const result = authenticationActivationReadiness(process.env);
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

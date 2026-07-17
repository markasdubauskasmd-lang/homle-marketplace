#!/usr/bin/env node
import { listRenderServiceEnvironment, renderEnvironmentActivationReport } from "../render-environment-readiness.mjs";

try {
  const serviceId = process.env.HOMLE_RENDER_SERVICE_ID;
  const entries = await listRenderServiceEnvironment({ serviceId, apiKey: process.env.RENDER_API_KEY });
  const report = renderEnvironmentActivationReport(entries);
  console.log(JSON.stringify({ serviceId, ...report }, null, 2));
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
}

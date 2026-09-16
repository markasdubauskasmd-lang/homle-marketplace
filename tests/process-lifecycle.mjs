import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { recordProcessLifecycle } from "../src/marketplace/process-lifecycle.mjs";

for (const paused of [false,true]) {
  const events = new EventEmitter(), lines = [];
  const lifecycle = recordProcessLifecycle({ processObject:events, write:line=>lines.push(JSON.parse(line)),
    bootId:"test-boot", commandWritesPaused:paused,
    release:{sourceCommit:"1234abcd",migrationCount:112,secret:"MUST_NOT_LOG"} });
  lifecycle.requestShutdown(); events.emit("exit",0); events.emit("exit",0);
  assert.equal(lines.length,2);
  assert.equal(lines[0].event,"homlle-process-start");
  assert.deepEqual(lines[1],{event:"homlle-process-exit",bootId:"test-boot",sourceCommit:"1234abcd",migrationCount:112,commandWritesPaused:paused,shutdownRequested:true,exitCode:0});
  assert(!JSON.stringify(lines).includes("MUST_NOT_LOG"));
}
{
  const events = new EventEmitter(), lines=[];
  recordProcessLifecycle({processObject:events,write:line=>lines.push(JSON.parse(line))});
  events.emit("exit",1);
  assert.equal(lines[1].shutdownRequested,false);assert.equal(lines[1].exitCode,1);
  const broken=new EventEmitter();
  assert.doesNotThrow(()=>recordProcessLifecycle({processObject:broken,write:()=>{throw Error("closed pipe");}}));
  assert.doesNotThrow(()=>broken.emit("exit",1));
}
// Real child process proves the final marker reaches a pipe despite queued
// asynchronous work and immediate process.exit; no network/provider involved.
const moduleUrl=new URL("../src/marketplace/process-lifecycle.mjs",import.meta.url).href;
const child=execFileSync(process.execPath,["--input-type=module","-e",`
 import {recordProcessLifecycle} from ${JSON.stringify(moduleUrl)};
 const lifecycle=recordProcessLifecycle({release:{sourceCommit:'1234abcd',migrationCount:112}});
 lifecycle.requestShutdown();
 setTimeout(()=>process.stdout.write('UNEXPECTED_LATE_COMMAND'),0);
 process.exit(0);
`],{encoding:"utf8",timeout:10000});
const records=child.trim().split("\n").map(JSON.parse);
assert.equal(records.length,2);assert.equal(records[0].bootId,records[1].bootId);
assert.match(records[0].bootId,/^[0-9a-f-]{36}$/);
assert.equal(records[1].event,"homlle-process-exit");
const server=readFileSync(new URL("../server.mjs",import.meta.url),"utf8");
assert.match(server,/recordProcessLifecycle\(\{ release: releaseIdentity, commandWritesPaused: marketplaceAttachment.paymentCommandWritesPaused \}\)/);
assert.match(server,/shutdownStarted = true;\s*processLifecycle.requestShutdown\(\);/);
console.log("Process lifecycle evidence passed: paired per-boot identity, synchronous real-process exit, bounded public fields and write-failure isolation.");

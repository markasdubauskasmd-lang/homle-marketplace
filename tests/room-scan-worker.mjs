import assert from 'node:assert/strict';
import {createWorkerDetectorAdapter} from '../public/room-scan-worker-adapter.js';
const tick=()=>new Promise(setImmediate);
function harness({badInit=false}={}){
  const timers=new Map(),messages=[];let timerId=0,loads=0,terminated=0;
  const fallbackCalls=[];
  const worker={postMessage(message,transfer){messages.push(structuredClone(message,{transfer}));},terminate(){terminated++;}};
  const adapter=createWorkerDetectorAdapter({createWorker:()=>{if(badInit)throw Error('unsupported');return worker;},
    snapshot:source=>({data:source.data.slice(),width:source.width,height:source.height}),
    loadFallback:async()=>{loads++;return {detect:async(frame,maxBoxes,minimumScore)=>{fallbackCalls.push({pixels:[...frame.data],maxBoxes,minimumScore});return [{class:'fallback',score:1}];}};},
    setTimer:callback=>{timers.set(++timerId,callback);return timerId;},clearTimer:id=>timers.delete(id)});
  return {adapter,worker,messages,timers,fallbackCalls,counts:()=>({loads,terminated}),reply(message,extra){worker.onmessage({data:{id:message.id,...extra}});}};
}
const frame=()=>({data:new Uint8ClampedArray([12,23,34,255]),width:1,height:1});
let cases=0;
for(const failure of ['constructor','init-timeout','init-error','wrong-backend','detect-timeout','detect-error','message-error','invalid-result']){
  const h=harness({badInit:failure==='constructor'});
  if(failure!=='constructor'){
    if(failure==='init-timeout')[...h.timers.values()][0]();
    else h.reply(h.messages[0],failure==='init-error'?{error:'load failed'}:{backend:failure==='wrong-backend'?'cpu':'webgpu'});
  }
  await h.adapter.ready;
  const original=frame(),p=h.adapter.detect(original,7,.71);original.data[0]=99;await tick();
  if(failure.startsWith('detect')||['message-error','invalid-result'].includes(failure)){
    if(failure==='detect-timeout')[...h.timers.values()][0]();
    else if(failure==='message-error')h.worker.onmessageerror();
    else h.reply(h.messages.at(-1),failure==='invalid-result'?{result:null}:{error:'inference failed'});
  }
  assert.equal((await p)[0].class,'fallback');assert.deepEqual(h.fallbackCalls[0],{pixels:[12,23,34,255],maxBoxes:7,minimumScore:.71});
  await h.adapter.detect(frame());assert.equal(h.counts().loads,1);assert.equal(h.timers.size,0);
  h.adapter.dispose();cases++;
}
{
  const h=harness();h.reply(h.messages[0],{backend:'webgpu'});await h.adapter.ready;
  const first=h.adapter.detect(frame()),second=h.adapter.detect(frame());await tick();assert.equal(h.messages.length,2);
  h.reply(h.messages[1],{result:[{class:'chair'}]});assert.equal((await first)[0].class,'chair');await tick();assert.equal(h.messages.length,3);
  h.reply(h.messages[1],{result:[{class:'stale'}]});
  h.reply(h.messages[2],{result:[{class:'table'}]});assert.equal((await second)[0].class,'table');assert.equal(h.counts().loads,0);
  h.adapter.dispose();assert.equal(h.timers.size,0);cases++;
}
for(const phase of ['loading','detecting']){
  const h=harness();if(phase==='detecting'){h.reply(h.messages[0],{backend:'webgpu'});await h.adapter.ready;}
  const p=h.adapter.detect(frame());const settled=assert.rejects(p,/detector-closed/);await tick();h.adapter.dispose();await settled;
  await assert.rejects(h.adapter.detect(frame()),/detector-closed/);assert.equal(h.counts().loads,0);assert.equal(h.timers.size,0);cases++;
}
console.log(JSON.stringify({passed:cases,scope:'Scanner worker lifecycle with transferred buffers and mocked failure modes.'}));


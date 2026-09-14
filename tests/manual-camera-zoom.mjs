import assert from "node:assert/strict";
import { createManualCameraZoom } from "../public/manual-camera-zoom.js";
import { nextManualZoom } from "../public/camera-assist.js";
let zoom = 1, errors = 0, seen = [], apply = async target => { zoom = target; };
const first = { getCapabilities: () => ({zoom:{min:1,max:4,step:.1}}), getSettings: () => ({zoom}), applyConstraints: ({advanced}) => apply(advanced[0].zoom) };
let track = first;
const change = createManualCameraZoom({getTrack:()=>track,onChange:value=>seen.push(value),onError:()=>errors++});
await change(); assert.equal(zoom, 1.5);
await change(true); assert.equal(zoom, 1);
let finish;
apply = target => new Promise(resolve => { finish = () => { zoom = target; resolve(); }; });
const pending = change(); await Promise.resolve();
const reset = change(true); finish(); await pending;
await Promise.resolve(); finish(); await reset; assert.equal(zoom,1,"A reset queued behind zoom must win");
apply = async () => { throw Error("device rejected"); };
await change(); assert.equal(zoom,1); assert.equal(errors,1);
apply = async () => {}; await change(); assert.equal(errors,2,"Ignored constraints must be reported");
apply = target => new Promise(resolve => { finish=()=>{zoom=target;resolve();}; });
const stale = change(); await Promise.resolve(); track=null; const count=seen.length; finish(); await stale;
assert.equal(seen.length,count,"A replaced camera must not receive stale state");
assert.equal(await change(true),false,"Unsupported desktop cameras remain usable without zoom");
for (const value of [1,1.3,1.6,2.2,2.8]) {
  const next=nextManualZoom({min:1,max:3,step:.3},value);
  assert.ok(Math.abs((next-1)/.3-Math.round((next-1)/.3))<1e-8);
}
console.log("Manual zoom: reset ordering, rejected/ignored constraints, replacement tracks and hardware steps passed.");

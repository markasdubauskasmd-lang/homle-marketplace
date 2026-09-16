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
{
  const updates = [], failures = [], applied = [];
  let oldZoom = 1, releaseOld;
  const oldTrack = {
    readyState: "live", getCapabilities: () => ({ zoom: { min: 1, max: 4, step: .1 } }),
    getSettings: () => ({ zoom: oldZoom }),
    applyConstraints: ({ advanced }) => new Promise(resolve => {
      applied.push("old"); releaseOld = () => { oldZoom = advanced[0].zoom; resolve(); };
    })
  };
  let active = oldTrack, replacementZoom = 2;
  const replacement = {
    readyState: "live", getCapabilities: oldTrack.getCapabilities,
    getSettings: () => ({ zoom: replacementZoom }),
    applyConstraints: async ({ advanced }) => { applied.push("replacement"); replacementZoom = advanced[0].zoom; }
  };
  const bounded = createManualCameraZoom({ getTrack: () => active, timeoutMs: 20,
    onChange: value => updates.push(value), onError: error => failures.push(error) });
  assert.equal(await bounded(), false, "A hung hardware constraint must settle at its deadline");
  assert.equal(failures[0].code, "zoom-timeout");
  assert.equal(failures[0].recoverCamera, true);
  assert.equal(await bounded(true), false, "Reset cannot overlap an uncancellable old constraint");
  assert.equal(failures[1].code, "zoom-busy");
  assert.deepEqual(applied, ["old"], "An unresolved hardware request must not be raced on the same track");
  active = replacement;
  assert.equal(await bounded(true), true, "A replacement track must escape the old track's hung queue");
  assert.equal(replacementZoom, 1);
  releaseOld(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(updates, [1], "Late completion cannot update the replacement camera's zoom label");
  assert.equal(failures.length, 2, "Late completion must not report a second failure");
}
{
  const applied = [], updates = [];
  let value = 1;
  const rapidTrack = {
    readyState: "live", getCapabilities: () => ({ zoom: { min: 1, max: 4, step: .1 } }),
    getSettings: () => ({ zoom: value }),
    applyConstraints: async ({ advanced }) => { await Promise.resolve(); value = advanced[0].zoom; applied.push(value); }
  };
  const rapid = createManualCameraZoom({ getTrack: () => rapidTrack,
    onChange: next => updates.push(next), onError: () => assert.fail("Valid rapid commands must not fail") });
  assert.deepEqual(await Promise.all([rapid(), rapid(), rapid(true)]), [true, true, true]);
  assert.deepEqual(applied, [1.5, 2, 1], "Rapid taps read actual settled settings and Reset wins last");
  assert.deepEqual(updates, applied);
  rapidTrack.readyState = "ended";
  assert.equal(await rapid(), false, "Ended tracks never receive a constraint");
  assert.equal(applied.length, 3);
}
{
  let release, value = 1, shouldStall = true;
  const recoveringTrack = {
    readyState: "live", getCapabilities: () => ({ zoom: { min: 1, max: 3, step: .1 } }),
    getSettings: () => ({ zoom: value }),
    applyConstraints: ({ advanced }) => shouldStall
      ? new Promise(resolve => { release = () => { value = advanced[0].zoom; resolve(); }; })
      : Promise.resolve().then(() => { value = advanced[0].zoom; })
  };
  const recovering = createManualCameraZoom({ getTrack: () => recoveringTrack, timeoutMs: 10,
    onChange: () => {}, onError: () => {} });
  assert.equal(await recovering(), false);
  release(); await Promise.resolve(); shouldStall = false;
  assert.equal(await recovering(true), true, "A track that eventually settles permits a fresh manual reset");
  assert.equal(value, 1);
}
console.log("Manual zoom: bounded stalls, per-track recovery, rapid reset ordering, rejected/ignored constraints and hardware steps passed.");

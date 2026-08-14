import { launchBrowser, serveStatic } from "./tools/browser-harness.mjs";
const s = await serveStatic();
const b = await launchBrowser();
await b.setViewport({ width: 1440, height: 900, mobile: false });
await b.goto(`${s.origin}/home.html`);
await b.evaluate(`await new Promise(r=>setTimeout(r,2500)); return 1;`);

// Scroll through a range while sampling frame deltas.
const measure = (fromVh, toVh, label) => `
  const H = window.innerHeight;
  const from = ${fromVh} * H, to = ${toVh} * H;
  window.scrollTo(0, from);
  await new Promise(r=>setTimeout(r,400));
  const deltas = [];
  let last = performance.now(), done = false, y = from;
  const step = (to - from) / 90;
  const tick = (t) => { deltas.push(t - last); last = t; if (!done) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  for (let i = 0; i < 90; i++) { y += step; window.scrollTo(0, y); await new Promise(r=>requestAnimationFrame(r)); }
  done = true;
  await new Promise(r=>setTimeout(r,100));
  const sorted = deltas.slice(2).sort((a,b)=>a-b);
  const p = (q) => sorted[Math.floor(sorted.length*q)]||0;
  return { label: ${JSON.stringify(label)}, frames: sorted.length,
    median: +p(.5).toFixed(1), p90: +p(.9).toFixed(1), worst: +sorted[sorted.length-1].toFixed(1),
    over32ms: sorted.filter(d=>d>32).length };
`;
for (const [a,c,l] of [[0,3,"Act 1 ci-open (the reveal)"],[3,6,"Act 2 ci-scan"],[11,14,"Act 5 ci-people"]]) {
  console.log(JSON.stringify(await b.evaluate(measure(a,c,l))));
}
await b.close(); await s.close();

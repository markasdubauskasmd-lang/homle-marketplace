import assert from 'node:assert/strict';
import {readFile, readdir, access} from 'node:fs/promises';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
const read=f=>readFile(new URL(f,root),'utf8');
const server=await read('server.mjs');
const headersCode=server.match(/function setSecurityHeaders\([\s\S]*?\n\}/)[0];
const ctx=vm.createContext({process:{env:{}},objectStorageOrigins:[],landlordDashboardPaths:new Set()});
vm.runInContext(headersCode,ctx);
function headers(route){const result={};ctx.setSecurityHeaders({setHeader:(k,v)=>result[k]=v},route);return result;}
for(const route of ['/','/cleaner/dashboard','/landlord/bookings','/design-preview-other/index.html']){
  const h=headers(route);
  assert.equal(h['X-Frame-Options'],'DENY');
  assert.match(h['Content-Security-Policy'],/frame-ancestors 'none'/);
  assert.doesNotMatch(h['Content-Security-Policy'],/tile.openstreetmap.org/);
}
const h=headers('/design-preview/index.html');
assert.equal(h['X-Frame-Options'],'SAMEORIGIN');
assert.match(h['Content-Security-Policy'],/script-src 'self';/);
assert.match(h['Content-Security-Policy'],/style-src 'self';/);
assert.match(h['Content-Security-Policy'],/form-action 'none'/);
assert.doesNotMatch(h['Content-Security-Policy'],/unsafe-inline|unsafe-eval/);
const runtime=await read('public/design-preview/support.js');
assert.doesNotMatch(runtime,/new Function\s*\(|\beval\s*\(/);
const compiled=await read('public/design-preview/compiled.js');
new vm.Script(compiled);
for(const name of await readdir(new URL('public/design-preview/',root))){
  if(!name.endsWith('.html'))continue;
  const page=await read('public/design-preview/'+name);
  assert.doesNotMatch(page,/<style\b/i,name);
  for(const script of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(script[1].includes('text/x-dc'))continue;
    const src=script[1].match(/src="([^"]+)"/)?.[1];
    assert.ok(src && !/^https?:/.test(src),name+' must load scripts locally');
    await access(new URL('public/design-preview/'+src,root));
  }
}
console.log('Homlle preview checks passed: unchanged app framing, self-only code/styles, precompiled logic, local script assets.');

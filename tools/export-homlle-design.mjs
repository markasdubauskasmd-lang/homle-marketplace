// Export the archived Design Components without evaluating source in the browser.
// Usage: node tools/export-homlle-design.mjs /path/to/vendor-directory
// Vendor directory: Babel standalone 7.29.0 (babel.cjs), React/ReactDOM 18.3.1
// (react.js/react-dom.js), Leaflet 1.9.4 (leaflet.js/leaflet.css).
import { readFile, writeFile, mkdir, cp, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'design/homlle');
const out = path.join(root, 'public/design-preview');
const vendor = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Supply the pinned vendor directory.');
const integrity = {
  'babel.cjs':'m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y',
  'react.js':'DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z',
  'react-dom.js':'gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1',
  'leaflet.js':'cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH',
  'leaflet.css':'sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H'
};
for (const [name,expected] of Object.entries(integrity)) {
  const actual=createHash('sha384').update(await readFile(path.join(vendor,name))).digest('base64');
  if(actual!==expected)throw new Error('Pinned vendor integrity mismatch: '+name);
}
const Babel = createRequire(import.meta.url)(path.join(vendor, 'babel.cjs'));
const read = async f => (await readFile(path.join(source, f), 'utf8')).replaceAll('\r\n','\n');
const save = async (f, content) => { await mkdir(path.dirname(path.join(out, f)), {recursive:true}); await writeFile(path.join(out, f), content); };
await mkdir(out, {recursive:true});
for (const f of ['assets','public/homlle-onboarding-logo-white.png','homlle-booking.js','_ds','index.html','preview.css']) {
  await cp(path.join(source,f),path.join(out,f),{recursive:true});
}
for (const f of ['react.js','react-dom.js','leaflet.js','leaflet.css']) {
  await mkdir(path.join(out,'vendor'),{recursive:true});
  await cp(path.join(vendor,f),path.join(out,'vendor',f));
}
let cssIndex = {};
async function cssFile(css) {
  const name = 'css/' + createHash('sha256').update(css).digest('hex').slice(0,16) + '.css';
  cssIndex[css] = name;
  await save(name,css);
  return name;
}
let runtime = await read('support.js');
const baseCss = runtime.match(/var BASE_CSS = `([\s\S]*?)`;/)[1].replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
await cssFile(baseCss);
await cssFile('x-dc{display:none!important}');
await cssFile('html,body{height:100%;margin:0}#dc-root,#dc-root>.sc-host{height:100%}');
// All runtime text styles must resolve to an exported, trusted stylesheet.
const helper = `
  function previewStyle(doc) {
    const el = doc.createElement('link'); el.rel = 'stylesheet'; let value = '';
    Object.defineProperty(el, 'textContent', {get:()=>value,set:(css)=>{
      const href = window.__homlleCss[css];
      if (!href) throw new Error('Unexported design stylesheet');
      value = css; el.href = href;
    }}); return el;
  }
`;
runtime = runtime.replace('  // src/react.ts', helper + '\n  // src/react.ts');
runtime = runtime.replace(/(?:doc|document)\.createElement\("style"\)/g, m => `previewStyle(${m.startsWith('document')?'document':'doc'})`);
runtime = runtime.replace(/function evalDcLogic\(src\) \{[\s\S]*?\n  \}/, `function evalDcLogic(src) {
    const factory = window.__homlleLogic[src.trim()];
    if (!factory) { if (!src.trim()) return undefined; throw new Error('Unexported design logic'); }
    return factory(StreamableLogic, StreamableLogic, getReact());
  }`);
runtime = runtime.replace(/new Function\("React", "module", "exports", "require", code\)\([\s\S]*?\n        \);/, `(()=>{ throw new Error('Dynamic modules are disabled in the published design'); })();`);
runtime = runtime.replace('let key = name;', `let key = name === 'data-preview-style' ? 'style' : name.replace(/^data-preview-on/, 'on');`);
runtime = runtime.replaceAll('getAttribute("style")','getAttribute("data-preview-style")').replaceAll('removeAttribute("style")','removeAttribute("data-preview-style")');
// Pseudo rules are trusted template values inserted through the CSSOM.
runtime = runtime.replace('el = previewStyle(doc);\n        doc.head.appendChild(el);\n      }\n      const cls', `el = {sheet:new CSSStyleSheet()};
        doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, el.sheet];
      }
      const cls`);
await save('support.js', runtime);
for (const f of ['browser-window.jsx','ios-frame.jsx']) {
  const code = Babel.transform(await read(f), {filename:f,presets:['react']}).code;
  await save(f.replace('.jsx','.js'), '(function(){\n'+code+'\n})();');
}
const names = (await readdir(source)).filter(f=>f.endsWith('.dc.html'));
const factories=[];
for (const name of names) {
  let html = await read(name);
  const logic = html.match(/<script\b[^>]*data-dc-script[^>]*>([\s\S]*?)<\/script>/i)?.[1] || '';
  if(logic.trim()) factories.push(`${JSON.stringify(logic.trim())}: function(DCLogic,StreamableLogic,React){\n${logic}\nreturn typeof Component!=='undefined'?Component:undefined;\n}`);
  const styles=[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];
  for(const m of styles) html=html.replace(m[0],`<link rel="stylesheet" href="${await cssFile(m[1])}">`);
  html=html.replace(/\sstyle=("[^"]*"|'[^']*')/gi,' data-preview-style=$1');
  html=html.replace(/\s(on[a-z]+)=("[^"]*"|'[^']*')/gi,' data-preview-$1=$2');
  html=html.replace(/\sfrom="\.\/(?:ios-frame|browser-window)\.jsx"/g,'');
  html=html.replace(/<script src="(?:\.\/)?image-slot\.js"><\/script>/g,'');
  html=html.replace(/<image-slot[^>]*src="([^"]+)"[^>]*><\/image-slot>/g,'<img src="$1" alt="" data-preview-style="width:100%;height:100%;object-fit:cover">');
  html=html.replace('<script src="./support.js"></script>', `<script src="vendor/react.js"></script><script src="vendor/react-dom.js"></script><script src="browser-window.js"></script><script src="ios-frame.js"></script><script src="compiled.js"></script><script src="./support.js"></script>`);
  // Branding metadata is otherwise absent in the archived components.
  html=html.replace('</head>',`<title>Homlle — ${name.replace('.dc.html','')}</title><link rel="stylesheet" href="css/hidden-template.css"></head>`);
  html=html.replace('Preview only — nothing in your repo has changed','Design preview — sample content');
  await save(name,html);
}
await save('css/hidden-template.css','x-dc{display:none!important}');
await save('compiled.js',`window.__homlleLogic={${factories.join(',\n')}};\nwindow.__homlleCss=${JSON.stringify(cssIndex)};\n`);
let map=await read('jobs-map.html');
map=map.replace(/https:\/\/unpkg.com\/leaflet@1.9.4\/dist\//g,'vendor/');
for(const m of [...map.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]) map=map.replace(m[0],`<link rel="stylesheet" href="${await cssFile(m[1])}">`);
const script=map.match(/<script>([\s\S]*?)<\/script>/)[1].replace('<span style="font-weight:800;letter-spacing:.1em;font-size:9.5px">','<span>');
await save('jobs-map.js',script);
map=map.replace(/<script>[\s\S]*?<\/script>/,'<script src="jobs-map.js"></script>');
await save('jobs-map.html',map);
const ds='_ds/modernist-b31e8f7a-e017-4700-9238-bcc6db4fa16c/styles.css';
let theme=await read(ds);
theme=theme.replace(/@import[^;]+;/g,`@font-face{font-family:Archivo;src:url('/vendor/fonts/archivo-wght-latin.woff2') format('woff2');font-weight:100 900;font-style:normal;font-display:swap;}`);
await save(ds,theme);
await save('README.txt','Generated from design/homlle by tools/export-homlle-design.mjs. Prototype with sample data; no live account operations.');
// The application's static handler uses URL paths directly. Publish filenames
// without spaces so no percent-decoding exception is needed in that handler.
for (const f of await readdir(out)) {
  if (!/\.(html|js)$/.test(f)) continue;
  let contents = await readFile(path.join(out,f),'utf8');
  for (const name of names) {
    const slug=name.toLowerCase().replaceAll(' ','-');
    contents=contents.replaceAll(encodeURIComponent(name),slug).replaceAll(name,slug);
  }
  const target=names.includes(f)?f.toLowerCase().replaceAll(' ','-'):f;
  await save(target,contents);
  if(target!==f) await unlink(path.join(out,f));
}
console.log(`Exported ${names.length} design screens to public/design-preview.`);

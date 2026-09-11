const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const jsonPath = path.join(__dirname, 'ohrsa_pets.json');
const indexPath = path.join(repo, 'index.html');
const imagesDir = path.join(repo, 'images');

function readIndex(){ return fs.readFileSync(indexPath,'utf8'); }
function extractScriptSimple(html, id){
  let pos = html.indexOf(`id="${id}"`);
  if(pos === -1) pos = html.indexOf(`id='${id}'`);
  if(pos === -1) return null;
  const scriptStart = html.lastIndexOf('<script', pos);
  if(scriptStart === -1) return null;
  const openEnd = html.indexOf('>', scriptStart);
  if(openEnd === -1) return null;
  const closeTag = html.indexOf('</script>', openEnd);
  if(closeTag === -1) return null;
  return html.slice(openEnd+1, closeTag);
}

let names = new Map();
if (fs.existsSync(jsonPath)){
  const raw = JSON.parse(fs.readFileSync(jsonPath,'utf8'));
  raw.forEach(item=>{ if(item && item.name) names.set(item.name, {src:item.img||'', source:'ohrsa_pets.json'}); });
}
if (fs.existsSync(indexPath)){
  const html = readIndex();
  const inner = extractScriptSimple(html, 'pet-data-extra');
  if(inner){ try{ const arr=JSON.parse(inner); arr.forEach(item=>{ if(item && item.name) names.set(item.name, {src:item.img||'', source:'pet-data-extra'}); }); }catch(e){} }
}

const files = fs.existsSync(imagesDir)?fs.readdirSync(imagesDir):[];
function existsFor(name, src){ const exts = [];
  if(src && typeof src==='string'){ const m=src.match(/\.([a-z0-9]{2,4})(?:\?|$)/i); if(m) exts.push('.'+m[1]); }
  exts.push('.gif','.png','.jpg','.jpeg','.webp');
  const candidates = [];
  exts.forEach(ext=>{ candidates.push(name+ext); candidates.push(encodeURIComponent(name)+ext); });
  // also fallback: any file that includes the name
  const found = files.find(f=> candidates.includes(f) || f.includes(name));
  return found;
}

const missing = [];
for(const [name, info] of names){ const found = existsFor(name, info.src); if(!found) missing.push({name, src:info.src, source:info.source}); }

console.log('Checked', names.size, 'unique names; images dir contains', files.length, 'files');
console.log('Missing count:', missing.length);
if(missing.length>0) console.log(missing.slice(0,200).map(m=>` - ${m.name} (src:${m.src||'<none>'}) [from:${m.source}]`).join('\n'));
process.exit(0);

#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const jsonPath = path.join(__dirname, 'ohrsa_pets.json');
const indexPath = path.join(root, 'index.html');

function readIndex() {
  return fs.readFileSync(indexPath, 'utf8');
}

function extractScriptContent(html, id) {
  // robust string-based search supporting single/double quotes
  let needle = `id=\"${id}\"`;
  let pos = html.indexOf(needle);
  if (pos === -1) { needle = `id='${id}'`; pos = html.indexOf(needle); }
  if (pos === -1) return null;
  const scriptStart = html.lastIndexOf('<script', pos);
  if (scriptStart === -1) return null;
  const openEnd = html.indexOf('>', scriptStart);
  if (openEnd === -1) return null;
  const closeTag = html.indexOf('</script>', openEnd);
  if (closeTag === -1) return null;
  return html.slice(openEnd+1, closeTag);
}

function mapExtra(e) {
  // 스크랩의 i 는 매 스크랩마다 바뀌는 페이지 내 순번이라 기존 pet-data id(ohrsa_N)와 충돌한다 -> 이름 해시로 고정 id 생성.
  const id = 'ohrsa_' + require('crypto').createHash('sha1').update(String(e.name || '')).digest('hex').slice(0, 8);
  const attrs = e.attrs || [];
  const attr = (attrs.map(a=>a[0]||'').join('')) || (e.attr||'');
  const initFromAlt = Array.isArray(e.init_내공방순) ? e.init_내공방순 : (Array.isArray(e.initS) ? e.initS : (Array.isArray(e.초기치_공방순내) ? [e.초기치_공방순내[3], e.초기치_공방순내[0], e.초기치_공방순내[1], e.초기치_공방순내[2]] : null));
  const initFinal = initFromAlt || e.init_내공방순 || e.initS || [0,0,0,0];
  const growth = e.growth_내공방순 || e.growthS || e.growth || [];
  return {
    id: id,
    name: e.name || '',
    attr: attr,
    attrs: attrs,
    obtain: e.obtain || e['획득'] || '',
    origin: e.origin || null,
    k: e.k || null,
    ok: !!e.ok,
    approx: true,
    initS: initFinal,
    growthS: growth,
    img: e.img || ''
  };
}

function validateItem(raw) {
  const problems = [];
  if (!raw.name || typeof raw.name !== 'string') problems.push('missing name');
  if (!raw.img || typeof raw.img !== 'string') problems.push('missing img');
  const init = raw.init_내공방순 || raw.initS || null;
  if (!Array.isArray(init) || init.length !== 4) problems.push('invalid initS');
  const growth = raw.growth_내공방순 || raw.growthS || raw.growth || null;
  if (!Array.isArray(growth) || growth.length !== 4) problems.push('invalid growthS');
  return problems;
}

try {
  if (!fs.existsSync(jsonPath)) { console.error('Missing', jsonPath); process.exit(1); }
  const rawJson = JSON.parse(fs.readFileSync(jsonPath,'utf8'));
  const indexHtml = readIndex();
  const baseContent = extractScriptContent(indexHtml, 'pet-data');
  if (!baseContent) { console.error('Could not find base pet-data in index.html'); process.exit(1); }
  const base = JSON.parse(baseContent);
  const baseNames = new Set(base.map(p=>p.name));

  const valid = [];
  const invalid = [];
  const dupes = [];

  for (const item of rawJson) {
    const problems = validateItem(item);
    if (problems.length) { invalid.push({item, problems}); continue; }
    if (baseNames.has(item.name)) { dupes.push(item.name); continue; }
    valid.push(mapExtra(item));
  }

  // 기존 pet-data-extra 는 지우지 않고, 아직 없는 이름만 뒤에 추가한다 (스크랩 목록에서 빠진 개체도 유지).
  const extraContent = extractScriptContent(indexHtml, 'pet-data-extra');
  const existingExtras = extraContent ? JSON.parse(extraContent) : [];
  const extraNames = new Set(existingExtras.map(p => p.name));
  const added = valid.filter(p => !extraNames.has(p.name) && extraNames.add(p.name));
  console.log('추가:', added.length, added.map(p => p.name).join(', '));
  const extraJson = JSON.stringify(existingExtras.concat(added), null, 2);

  let newHtml;
  if (extractScriptContent(indexHtml, 'pet-data-extra') !== null) {
    newHtml = indexHtml.replace(/<script[^>]+id="pet-data-extra"[^>]*>[\s\S]*?<\/script>/i,
      `<script type="application/json" id="pet-data-extra">${extraJson}</script>`);
  } else {
    // insert before </body>
    newHtml = indexHtml.replace(/<\/body>/i, `<script type="application/json" id="pet-data-extra">${extraJson}</script>\n</body>`);
  }

  fs.writeFileSync(indexPath, newHtml, 'utf8');

  console.log('Merge complete. Summary:');
  console.log(' - Added:', valid.length);
  console.log(' - Duplicates skipped (existing in base):', dupes.length);
  if (dupes.length) console.log('   ', dupes.slice(0,20).join(', '));
  console.log(' - Invalid items:', invalid.length);
  if (invalid.length) console.log('   ', invalid.slice(0,10).map(i=>`${i.item.name||'<no-name>'}: ${i.problems.join(';')}`).join('\n   '));
  process.exit(0);
} catch (err) {
  console.error('Error:', err && err.message || err);
  process.exit(2);
}

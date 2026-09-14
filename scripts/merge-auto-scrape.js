#!/usr/bin/env node
/*
 * scripts/ohrsa_pets_auto.json (scrape-ohrsa.playwright.js 결과) 를 index.html 의
 * pet-data-extra 에 "추가"만 한다 (add-validate-merge.js 와 달리 기존 pet-data-extra
 * 내용을 절대 통째로 교체하지 않음).
 *
 * add-validate-merge.js 는 scripts/ohrsa_pets.json 을 유일한 소스로 보고 pet-data-extra
 * 를 매번 재생성하기 때문에, 그 파일에 없는 수동 등록 개체(예: 퀘스트 보상 펫처럼
 * ohrsa.net 도감 스크랩 대상이 아닌 것)가 있으면 자동 스크랩 파이프라인이 그걸
 * 지워버리는 문제가 있다. 이 스크립트는 base(pet-data) 이름 집합과 기존
 * pet-data-extra 이름 집합 둘 다에 없는, "진짜 새로 스크랩된" 항목만 골라 기존
 * pet-data-extra 배열 뒤에 이어붙인다.
 *
 * exit code 0 + stdout 에 "CHANGED" 출력 = 새로 추가된 항목이 있어 index.html 이
 * 바뀜 (워크플로가 이걸 보고 커밋 여부를 결정).
 *
 * 사용법: node scripts/merge-auto-scrape.js
 */
const fs = require('fs');
const path = require('path');
const { solve } = require('./solve-origin-k');

const root = path.resolve(__dirname, '..');
const scrapedPath = path.join(__dirname, 'ohrsa_pets_auto.json');
const indexPath = path.join(root, 'index.html');

function extractScriptContent(html, id) {
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
  return html.slice(openEnd + 1, closeTag);
}

function mapExtra(e) {
  const id = e.id !== undefined ? String(e.id) : (e.i !== undefined ? 'ohrsa_' + String(e.i) : 'ohrsa_' + Math.random().toString(36).slice(2, 8));
  const attrs = e.attrs || [];
  const attr = (attrs.map(a => a[0] || '').join('')) || (e.attr || '');
  const initFromAlt = Array.isArray(e.init_내공방순) ? e.init_내공방순 : (Array.isArray(e.initS) ? e.initS : (Array.isArray(e.초기치_공방순내) ? [e.초기치_공방순내[3], e.초기치_공방순내[0], e.초기치_공방순내[1], e.초기치_공방순내[2]] : null));
  const initFinal = initFromAlt || e.init_내공방순 || e.initS || [0, 0, 0, 0];
  const growth = e.growth_내공방순 || e.growthS || e.growth || [];
  // 표기 초기치·성장률에서 origin/k 를 역산한다. 예전에는 origin:null, approx:true 로
  // 하드코딩해서 새 펫이 전부 "근사 추정" 상태로 들어왔다 - 그래서 카르곤이 계산 불가
  // 개체로 추가됐었다. 해가 나오면 정확 개체로, 안 나오면 그때만 approx 로 둔다.
  const sol = solve(growth, initFinal)[0] || null;
  if (!sol) console.log(`  ! ${e.name || '<무명>'}: origin/k 역산 실패 -> approx 처리`);

  return {
    id: id,
    name: e.name || '',
    attr: attr,
    attrs: attrs,
    obtain: e.obtain || e['획득'] || '',
    origin: sol ? sol.origin : (e.origin || null),
    k: sol ? sol.k : (e.k || null),
    ok: !!sol,
    approx: !sol,
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
  if (!fs.existsSync(scrapedPath)) { console.error('Missing', scrapedPath); process.exit(1); }
  const scraped = JSON.parse(fs.readFileSync(scrapedPath, 'utf8'));
  const indexHtml = fs.readFileSync(indexPath, 'utf8');

  const baseContent = extractScriptContent(indexHtml, 'pet-data');
  if (!baseContent) { console.error('Could not find base pet-data in index.html'); process.exit(1); }
  const base = JSON.parse(baseContent);
  const baseNames = new Set(base.map(p => p.name));

  const extraContent = extractScriptContent(indexHtml, 'pet-data-extra');
  const existingExtras = extraContent ? JSON.parse(extraContent) : [];
  const extraNames = new Set(existingExtras.map(p => p.name));

  const added = [];
  const invalid = [];
  for (const item of scraped) {
    if (baseNames.has(item.name) || extraNames.has(item.name)) continue;
    const problems = validateItem(item);
    if (problems.length) { invalid.push({ name: item.name, problems }); continue; }
    added.push(mapExtra(item));
    extraNames.add(item.name); // 스크랩 결과 안 중복 이름 대비
  }

  console.log('신규 후보:', scraped.length, '| 이미 존재:', scraped.length - added.length - invalid.length, '| 무효:', invalid.length, '| 추가:', added.length);
  if (invalid.length) console.log('  무효 항목:', invalid.slice(0, 10).map(i => `${i.name || '<no-name>'}: ${i.problems.join(';')}`).join('\n  '));

  if (added.length === 0) {
    console.log('NO_CHANGE');
    process.exit(0);
  }

  const merged = existingExtras.concat(added);
  const mergedJson = JSON.stringify(merged, null, 2);
  const newHtml = extraContent !== null
    ? indexHtml.replace(/<script[^>]+id="pet-data-extra"[^>]*>[\s\S]*?<\/script>/i,
        `<script type="application/json" id="pet-data-extra">${mergedJson}</script>`)
    : indexHtml.replace(/<\/body>/i, `<script type="application/json" id="pet-data-extra">${mergedJson}</script>\n</body>`);

  fs.writeFileSync(indexPath, newHtml, 'utf8');
  console.log('CHANGED');
  console.log('추가된 펫:', added.map(a => a.name).join(', '));
  process.exit(0);
} catch (err) {
  console.error('Error:', err && err.message || err);
  process.exit(2);
}

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
const { solve, bandB, RANKS } = require('./solve-origin-k');

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

// 획득 문구 "Lv120이상 X 환생|진화" -> { variant, src: X }. 120/130/140 구간은 보상 차이뿐이라 구분 안 함.
function variantOf(e) {
  const m = String(e.obtain || '').match(/Lv\d+이상\s+(.+?)\s+(환생|진화)/);
  return m ? { variant: m[2], src: m[1] } : null;
}

function mapExtra(e, variant, solveOpts = {}) {
  // 스크랩의 i 는 매 스크랩마다 바뀌는 페이지 내 순번이라 기존 pet-data id(ohrsa_N)와 충돌한다 -> 이름 해시로 고정 id 생성.
  // 환생·진화는 원본과 이름이 같으므로 형태까지 넣어 해시한다.
  const id = 'ohrsa_' + require('crypto').createHash('sha1').update(String(e.name || '') + (variant ? '|' + variant : '')).digest('hex').slice(0, 8);
  const attrs = e.attrs || [];
  const attr = (attrs.map(a => a[0] || '').join('')) || (e.attr || '');
  const initFromAlt = Array.isArray(e.init_내공방순) ? e.init_내공방순 : (Array.isArray(e.initS) ? e.initS : (Array.isArray(e.초기치_공방순내) ? [e.초기치_공방순내[3], e.초기치_공방순내[0], e.초기치_공방순내[1], e.초기치_공방순내[2]] : null));
  const initFinal = initFromAlt || e.init_내공방순 || e.initS || [0, 0, 0, 0];
  const growth = e.growth_내공방순 || e.growthS || e.growth || [];
  // 표기 초기치·성장률에서 origin/k 를 역산한다. 예전에는 origin:null, approx:true 로
  // 하드코딩해서 새 펫이 전부 "근사 추정" 상태로 들어왔다 - 그래서 카르곤이 계산 불가
  // 개체로 추가됐었다. 해가 나오면 정확 개체로, 안 나오면 그때만 approx 로 둔다.
  const sol = (solveOpts.B != null ? solveVariant(growth, initFinal, solveOpts.B) : solve(growth, initFinal)[0]) || null;
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
    _resid: sol ? sol.resid : null,
    initS: initFinal,
    growthS: growth,
    img: e.img || ''
  };
}

// 환생·진화 역산 채택 한계. 원본 B 에서 정수해면 잔차 0.01 미만(88건 실측), 오타 데이터는 0.3 이상.
const MAX_RESID = 0.05;

// 원본 B 우선, 정수해가 없으면 다른 밴드의 정수해(프라키토스 환생: 원본 475 -> 495 에서 잔차 0.005, 게임 실측 일치).
function solveVariant(growth, init, B) {
  const first = solve(growth, init, undefined, { B })[0];
  if (first && first.resid <= MAX_RESID) return first;
  const all = RANKS.map(r => solve(growth, init, undefined, { B: (r.Blo + r.Bhi) / 2 })[0]).filter(Boolean).sort((a, b) => a.resid - b.resid);
  return all[0] && all[0].resid <= MAX_RESID ? all[0] : null;
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
  // 사이트 표기가 틀린 개체는 게임 실측값으로 덮는다. 키 = '이름|환생|진화' 또는 '이름'.
  const overridesPath = path.join(__dirname, 'ohrsa_overrides.json');
  const OVR = fs.existsSync(overridesPath) ? JSON.parse(fs.readFileSync(overridesPath, 'utf8')) : {};
  for (const e of scraped) {
    const v = variantOf(e);
    const o = OVR[v ? `${e.name}|${v.variant}` : e.name];
    if (!o) continue;
    if (o.initS) e.init_내공방순 = o.initS;
    if (o.growthS) e.growth_내공방순 = o.growthS;
  }
  const indexHtml = fs.readFileSync(indexPath, 'utf8');

  const baseContent = extractScriptContent(indexHtml, 'pet-data');
  if (!baseContent) { console.error('Could not find base pet-data in index.html'); process.exit(1); }
  const base = JSON.parse(baseContent);
  const baseNames = new Set(base.map(p => p.name));

  const extraContent = extractScriptContent(indexHtml, 'pet-data-extra');
  const existingExtras = extraContent ? JSON.parse(extraContent) : [];
  const extraNames = new Set(existingExtras.map(p => p.name));

  // ---- 환생·진화 개체 ----
  // 사이트는 환생/진화 개체를 원본과 같은 이름으로 따로 올린다 (획득 "Lv120이상 X 환생|진화").
  // 원본 = 같은 이름의 비(非)환생 항목, 없으면 획득 문구의 X (이름이 바뀌는 진화, 예: 토라 -> 베르푸스).
  // 환생은 외형이 안 바뀌므로 GIF 는 원본 것을 쓴다(imgOf). 진화는 GIF 가 달라 따로 받는다.
  const plainNames = new Set(scraped.filter(e => !variantOf(e)).map(e => e.name));
  const idByName = new Map();
  const nk = s => String(s).replace(/\s+/g, ''); // 사이트 획득 문구는 "어린흑룡", 데이터는 "어린 흑룡"
  for (const p of base) idByName.set(nk(p.name), String(p.id));
  for (const p of existingExtras) if (!p.variant) idByName.set(nk(p.name), String(p.id));
  const petById = new Map([...base, ...existingExtras].map(p => [String(p.id), p]));
  // 환생·진화는 원본 펫의 밴드 B 로 역산한다 (solve-origin-k.js opts.B 주석 참고).
  const baseOpts = id => { const b = petById.get(String(id)); return b && b.origin ? { B: bandB(b.origin) } : {}; };
  const variantKeys = new Set(existingExtras.filter(p => p.variant).map(p => p.name + '|' + p.variant));
  const held = [];
  let linked = 0;
  const statKey = e => JSON.stringify([e.init_내공방순, e.growth_내공방순]);
  const seenVariant = new Map();

  const added = [];
  const invalid = [];
  for (const item of scraped) {
    const v = variantOf(item);
    if (v) {
      const baseName = plainNames.has(item.name) ? item.name : v.src;
      const baseId = idByName.get(nk(baseName));
      if (baseName !== item.name) {
        // 이름이 바뀌는 진화: 이미 단독 개체로 들어와 있으면 원본에 연결만 한다.
        const own = existingExtras.find(p => p.name === item.name && !p.variant);
        if (own || baseNames.has(item.name)) {
          if (own && baseId && !own.baseId) { own.variant = v.variant; own.baseId = baseId; linked++; }
          continue;
        }
      }
      const key = item.name + '|' + v.variant;
      if (variantKeys.has(key)) continue;
      if (seenVariant.has(key)) {
        if (seenVariant.get(key) !== statKey(item)) held.push(`${key}: 같은 형태가 수치 다르게 중복`);
        continue;
      }
      seenVariant.set(key, statKey(item));
      if (!baseId) { held.push(`${key}: 원본 '${baseName}' 없음`); continue; }
      const problems = validateItem(item);
      if (problems.length) { invalid.push({ name: key, problems }); continue; }
      const m = mapExtra(item, v.variant, baseOpts(baseId));
      if (!m.ok || m._resid > MAX_RESID) { held.push(`${key}: origin/k 정수해 없음 ${statKey(item)}`); continue; }
      delete m._resid;
      m.variant = v.variant;
      m.baseId = baseId;
      if (v.variant === '환생') { m.imgOf = baseId; m.img = ''; }
      added.push(m);
      continue;
    }
    if (baseNames.has(item.name) || extraNames.has(item.name)) continue;
    const problems = validateItem(item);
    if (problems.length) { invalid.push({ name: item.name, problems }); continue; }
    { const m = mapExtra(item); delete m._resid; added.push(m); }
    extraNames.add(item.name); // 스크랩 결과 안 중복 이름 대비
  }

  // 기존 환생·진화도 원본 B 기준으로 다시 역산 (해가 바뀐 것만 갱신, 실패하면 기존 값 유지).
  let resolved = 0;
  const dropIds = new Set();
  for (const p of existingExtras) {
    if (!p.variant || !p.baseId) continue;
    const o = OVR[`${p.name}|${p.variant}`];
    if (o && o.initS && JSON.stringify(o.initS) !== JSON.stringify(p.initS)) { p.initS = o.initS; resolved++; }
    if (o && o.growthS && JSON.stringify(o.growthS) !== JSON.stringify(p.growthS)) { p.growthS = o.growthS; resolved++; }
    const sol = solveVariant(p.growthS, p.initS, baseOpts(p.baseId).B);
    if (!sol) { held.push(`${p.name}|${p.variant}: 원본 B 기준 정수해 없음 -> 데이터에서 제외`); dropIds.add(p.id); resolved++; continue; }
    if (JSON.stringify(sol.origin) !== JSON.stringify(p.origin) || sol.k !== p.k || !p.ok) {
      console.log(`  재역산 ${p.name}(${p.variant}): origin ${p.origin} k ${p.k} -> ${sol.origin} k ${sol.k}`);
      p.origin = sol.origin; p.k = sol.k; p.ok = true; p.approx = false; resolved++;
    }
  }

  console.log('신규 후보:', scraped.length, '| 이미 존재:', scraped.length - added.length - invalid.length, '| 무효:', invalid.length, '| 추가:', added.length);
  if (invalid.length) console.log('  무효 항목:', invalid.slice(0, 10).map(i => `${i.name || '<no-name>'}: ${i.problems.join(';')}`).join('\n  '));
  if (linked) console.log('원본 연결(이름 바뀌는 진화):', linked);
  if (held.length) console.log('환생·진화 보류 ' + held.length + '건:\n  ' + held.join('\n  '));

  if (resolved) console.log('원본 B 기준 재역산:', resolved);
  if (added.length === 0 && linked === 0 && resolved === 0) {
    console.log('NO_CHANGE');
    process.exit(0);
  }

  const merged = existingExtras.filter(p => !dropIds.has(p.id)).concat(added);
  const mergedJson = JSON.stringify(merged, null, 2);
  const newHtml = extraContent !== null
    ? indexHtml.replace(/<script[^>]+id="pet-data-extra"[^>]*>[\s\S]*?<\/script>/i,
        () => `<script type="application/json" id="pet-data-extra">${mergedJson}</script>`)
    : indexHtml.replace(/<\/body>/i, `<script type="application/json" id="pet-data-extra">${mergedJson}</script>\n</body>`);

  fs.writeFileSync(indexPath, newHtml, 'utf8');
  console.log('CHANGED');
  console.log('추가된 펫:', added.map(a => a.variant ? `${a.name}(${a.variant})` : a.name).join(', '));
  process.exit(0);
} catch (err) {
  console.error('Error:', err && err.message || err);
  process.exit(2);
}

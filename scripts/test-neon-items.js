#!/usr/bin/env node
/*
 * neon-items.json (scrape-neon-items.js 결과) 검증 - 네온 아이템 탭이 그대로 그릴 수 있는지.
 *  - 아이템이 있고 번호가 겹치지 않음
 *  - 이름·분류가 있고, 분류가 화면의 분류 묶음(index.html N_ITEM_GROUPS)에 들어 있음
 *  - 이미지가 로컬 파일(images/neon-items/)이고 실제로 있음
 *  - 능력치 한 줄을 읽은 값(stats)이 비지 않았고, 변형 표의 첫 행(대표 변형)이 능력치 한 줄과 맞음
 *  - 제작 재료 단계는 양의 정수
 *
 * 사용법: node scripts/test-neon-items.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'neon-items.json'), 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 화면의 분류 묶음을 index.html 에서 그대로 꺼낸다
const gm = html.match(/const N_ITEM_GROUPS = (\[[\s\S]*?\]);/);
assert(gm, 'index.html 에 N_ITEM_GROUPS 가 없음');
const GROUPS = new Function(`return ${gm[1]}`)();
const KNOWN = new Set(GROUPS.flatMap(([, cs]) => cs));

const items = doc.items;
let failures = 0;
const fail = msg => { failures++; console.error('  ✗ ' + msg); };

assert(Array.isArray(items) && items.length > 0, '아이템이 비어 있음');
const ids = new Set(items.map(it => it.id));
assert.strictEqual(ids.size, items.length, '아이템 번호 중복');

let withVariants = 0, withMats = 0, withPrice = 0;
for (const it of items) {
  if (!it.name) fail(`${it.id}: 이름 없음`);
  if (!KNOWN.has(it.cat)) fail(`${it.id} ${it.name}: 화면 분류 묶음에 없는 분류 '${it.cat}' (기타로 보임)`);
  if (!it.img || /^https?:/.test(it.img)) fail(`${it.id} ${it.name}: 이미지가 로컬이 아님 (${it.img})`);
  else if (!fs.existsSync(path.join(ROOT, it.img))) fail(`${it.id} ${it.name}: 이미지 파일 없음 ${it.img}`);
  // 능력치가 비면: 한 줄이 있었거나, 설명에 능력치 모양(공+5, 공[1~3])이 남아 있으면 못 읽은 것.
  // 능력치가 원래 없는 아이템도 있다 (펜던트 조각 목걸이 - 퀘스트 아이템)
  // 산적의 활처럼 타격 횟수 '(x3-5)'만 있는 아이템도 있다 -> 타격 횟수를 빼고 남는 글이 있을 때만 실패
  const looksStat = /[가-힣]+\s?[+-]\d|[가-힣]+\[-?\d+~/.test(it.desc || '');
  const statPart = (it.statline || '').replace(/\(x[\d-]+\)/g, '').trim();
  if ((!it.stats || !Object.keys(it.stats).length) && (statPart || looksStat)) {
    fail(`${it.id} ${it.name}: 능력치를 못 읽음 (한 줄 '${it.statline}', 설명 '${it.desc}')`);
  }
  for (const [k, r] of Object.entries(it.stats || {})) {
    if (!Array.isArray(r) || r.length !== 2 || !(r[0] <= r[1])) fail(`${it.id} ${it.name}: 능력치 ${k} 범위 형식 ${JSON.stringify(r)}`);
  }
  if (it.lv && !/^Lv\.\d+(~\d+)?$/.test(it.lv)) fail(`${it.id} ${it.name}: 레벨 형식 '${it.lv}'`);
  for (const v of it.variants || []) {
    if (!/^\d+$/.test(v.no)) fail(`${it.id} ${it.name}: 변형 번호 '${v.no}'`);
  }
  // 대표 변형 = 표 첫 행 = 목록의 능력치 한 줄 (표에 있는 능력치만 비교)
  const v0 = (it.variants || [])[0];
  if (v0) {
    for (const [k, val] of Object.entries(v0.stats)) {
      if (!(k in it.stats)) fail(`${it.id} ${it.name}: 변형 표의 '${k}' 가 능력치 한 줄(${it.statline})에 없음 (열 이름 대응 확인)`);
      else if (JSON.stringify(it.stats[k]) !== JSON.stringify(val)) fail(`${it.id} ${it.name}: 대표 변형 ${k} ${val} ≠ 능력치 한 줄 ${it.stats[k]}`);
    }
  }
  for (const m of it.materials || []) {
    if (!m.name || !Number.isInteger(m.lv) || m.lv < 1) fail(`${it.id} ${it.name}: 제작 재료 ${JSON.stringify(m)}`);
  }
  if (it.variants && it.variants.length > 1) withVariants++;
  if (it.materials && it.materials.length) withMats++;
  if (it.price != null) withPrice++;
}

console.log(`네온 아이템 ${items.length}종 · 변형 있음 ${withVariants} · 제작 재료 ${withMats} · 가격 ${withPrice}`);
if (failures) { console.error(`실패 ${failures}건`); process.exit(1); }
console.log('test-neon-items: OK');

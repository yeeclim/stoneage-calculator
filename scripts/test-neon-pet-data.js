#!/usr/bin/env node
/*
 * index.html 에 주입된 네온 데이터(#pet-data-neon)를 계산기의 실제 계산 코드로 검증한다.
 * 계산 함수는 베껴 쓰지 않고 index.html 에서 그대로 꺼내 실행한다.
 *
 *  1) 구조: id 중복 없음, 이미지 파일 존재, 초기치·성장률 4개씩
 *  2) 계산 가능 개체(ok)는 S급 표기 초기치가 "일치하는 조합 없음" 없이 +8 등급까지 재현된다
 *  3) 계산 가능 개체의 S급 소수 계산값이 네온 도감 표기(소수)와 0.05 이내로 맞는다
 *
 * 사용법: node scripts/test-neon-pet-data.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function jsonBlock(id) {
  const open = `<script type="application/json" id="${id}">`;
  const a = html.indexOf(open);
  assert(a >= 0, `#${id} 블록 없음`);
  const b = html.indexOf('</script>', a);
  return JSON.parse(html.slice(a + open.length, b));
}

function codeBetween(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  const b = html.indexOf(endMarker, a);
  assert(a >= 0 && b > a, `코드 구간 못 찾음: ${startMarker}`);
  return html.slice(a, b);
}

function extractFunction(name) {
  const a = html.indexOf(`function ${name}(`);
  assert(a >= 0, `function ${name} 없음`);
  let depth = 0, i = html.indexOf('{', a);
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(a, i + 1);
}

const calcSrc = codeBetween('// ---- combinatorics setup ----', '// ---- chosung search ----')
  + '\n' + extractFunction('calcSGradeInitDecimal');
const { computeGradeDist, calcSGradeInitDecimal } =
  new Function(`${calcSrc}\nreturn { computeGradeDist, calcSGradeInitDecimal };`)();

const pets = jsonBlock('pet-data-neon');
const byId = new Map(pets.map(p => [p.id, p]));
let failures = 0;
const fail = msg => { failures++; console.error('  ✗ ' + msg); };

// 1) 구조
assert(pets.length > 0, '네온 데이터가 비어 있음');
assert.strictEqual(byId.size, pets.length, 'id 중복');
for (const p of pets) {
  assert(p.id.startsWith('neon_'), `id 접두어: ${p.id}`);
  if (/^https?:/.test(p.img || '')) fail(`${p.name} 이미지가 외부 URL (localize-images.js 실행 필요): ${p.img}`);
  else if (!p.img || !fs.existsSync(path.join(ROOT, p.img))) fail(`${p.name} 이미지 파일 없음: ${p.img}`);
  for (const k of ['initS', 'growthS']) {
    if (!Array.isArray(p[k]) || p[k].length !== 4) fail(`${p.name} ${k} 형식`);
  }
}

// 2), 3) 계산
let okCount = 0, approxCount = 0, maxDiff = 0, worst = null;
for (const p of pets.filter(x => x.ok)) {
  okCount++;
  if (p.approx) approxCount++;
  const { counts, total } = computeGradeDist(p.origin, p.k, p.initS);
  if (!total) { fail(`${p.name}: S급 초기치 ${p.initS.join('/')} 일치 조합 없음`); continue; }
  if (!counts[8]) fail(`${p.name}: S급 초기치가 +8 등급으로 재현 안 됨`);
  if (Array.isArray(p.initDec)) {
    const calc = calcSGradeInitDecimal(p);
    const d = Math.max(...calc.map((v, i) => Math.abs(v - p.initDec[i])));
    if (d > maxDiff) { maxDiff = d; worst = p; }
    if (d > 0.05) fail(`${p.name}: 계산값 ${calc.map(v => v.toFixed(2)).join('/')} vs 네온 ${p.initDec.join('/')}`);
  }
}

console.log(`네온 ${pets.length}마리 · 계산 가능 ${okCount} (근사 ${approxCount}) · 소수 초기치 최대 오차 ${maxDiff.toFixed(3)}${worst ? ` (${worst.name})` : ''}`);
if (failures) { console.error(`실패 ${failures}건`); process.exit(1); }
console.log('test-neon-pet-data: OK');

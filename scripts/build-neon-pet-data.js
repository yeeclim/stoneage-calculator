#!/usr/bin/env node
/*
 * scripts/neon_pets.json (scrape-neon.js 결과) -> scripts/neon_pet_data.json
 * (index.html <script id="pet-data-neon"> 에 넣을 계산기 형식)
 *
 * 네온 도감의 초기치·성장률은 S급 기준 "내림 전 소수값"(소수 둘째 자리)이다. 계산기 모델로 쓰면
 *   초기 = M · (k · v / 100),  성장 = M · (v · B / 10000),  v = origin + 2(오프셋) + 2.5(보너스 평균)
 * 인데, 236마리 전부가 아래 조건으로 초기·성장 8개 값을 둘째 자리까지 정확히 재현한다.
 *   - k 는 정수 (10~30)
 *   - B 는 RANK 밴드 중앙값(475/495/515/535/555/575)이고, origin 합으로 정해지는 밴드와 일치
 *   - v 는 0.25 단위 (오르·제로는 정수 origin 이라 v 가 항상 x.5 인 것과 다름)
 * 그래서 origin 을 0.25 단위 소수 그대로 둔다. 0.25 배수는 부동소수로 정확해서 계산기 코드
 * (computeGradeDist 등)를 바꾸지 않고 그대로 계산된다.
 *
 * 절차: 초기(u)·성장(w)을 M 역행렬로 풀면 u = (100k/B)·w 로 비례한다 -> 밴드마다 k = round(c·B/100),
 *       v = round(4·100u/k)/4 로 두고 초기·성장 재현 오차가 가장 작은 조합을 채택한다.
 *
 * initS(계산기 "S급 참고 초기치", 정수)는 소수값을 내림한 값. 그 값이 +8 등급(오프셋 전부 +2)의
 * 정수 보너스분배로 안 나오는 개체는 +8 에서 가장 흔한 표기값으로 바꾼다(그대로 두면 초기화
 * 버튼을 눌렀을 때 "일치하는 조합이 없습니다"가 뜬다).
 *
 * 사용법: node scripts/build-neon-pet-data.js  -> scripts/neon_pet_data.json
 */
const fs = require('fs');
const path = require('path');
const { disp, stats, Ds } = require('./solve-origin-k.js');

const SRC = path.join(__dirname, 'neon_pets.json');
const OUT = path.join(__dirname, 'neon_pet_data.json');
const GRADE_OFF = 2, BONUS = 2.5;
const TOL = 0.0051; // 표기값이 소수 둘째 자리 반올림이라 ±0.005
const BANDS = [ // origin 합(오프셋 +2 기준) 하한 -> B 중앙값. 합이 0.25 단위라 '하한 이상인 첫 밴드'로 고른다.
  { lo: 100, B: 475 }, { lo: 95, B: 495 }, { lo: 90, B: 515 },
  { lo: 85, B: 535 }, { lo: 80, B: 555 }, { lo: -Infinity, B: 575 },
];
const bandB = sum => BANDS.find(b => sum >= b.lo).B;

// M · x = rhs  (M = [[4,1,1,1],[.1,1,.1,.05],[.1,.1,1,.05],[0,0,0,1]])
function invM(rhs) {
  const a3 = rhs[3];
  const R0 = rhs[0] - a3, R1 = rhs[1] - 0.05 * a3, R2 = rhs[2] - 0.05 * a3;
  const a0 = (1.1 * R0 - R1 - R2) / 4.2;
  const a2 = (R0 - R1 - 3.9 * a0) / 0.9;
  const a1 = R0 - 4 * a0 - a2;
  return [a0, a1, a2, a3];
}

function fit(initDec, growth) {
  const u = invM(initDec), w = invM(growth);
  const c = u.reduce((a, b) => a + b, 0) / w.reduce((a, b) => a + b, 0); // = 100k/B
  let best = null;
  for (const { B } of BANDS) {
    const k = Math.round(c * B / 100);
    if (k < 1) continue;
    const v = u.map(x => Math.round(400 * x / k) / 4);
    const eI = Math.max(...disp(v.map(x => k * x / 100)).map((x, i) => Math.abs(x - initDec[i])));
    const eG = Math.max(...disp(v.map(x => x * B / 10000)).map((x, i) => Math.abs(x - growth[i])));
    const origin = v.map(x => x - GRADE_OFF - BONUS);
    const sum = origin.reduce((a, b) => a + b, 0);
    const cand = { B, k, origin, eI, eG, bandOk: bandB(sum) === B };
    const score = eI + eG + (cand.bandOk ? 0 : 1);
    if (!best || score < best.score) best = { ...cand, score };
  }
  best.exact = best.eI <= TOL && best.eG <= TOL && best.bandOk && best.origin.every(o => o >= 0);
  return best;
}

// 보너스 10포인트 다항분포 가중치 (index.html BONUS_W 와 같음)
const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800];
const BONUS_W = Ds.map(D => FACT[10] / (FACT[D[0]] * FACT[D[1]] * FACT[D[2]] * FACT[D[3]]) / Math.pow(4, 10));

// +8(오프셋 전부 +2) 에서 나오는 표기값 -> 확률
function topGradeDist(origin, k) {
  const m = new Map();
  Ds.forEach((D, i) => {
    const key = stats(k, origin.map((o, j) => o + GRADE_OFF + D[j])).join('/');
    m.set(key, (m.get(key) || 0) + BONUS_W[i]);
  });
  return m;
}

function pickInitS(initDec, origin, k) {
  const floorS = initDec.map(x => Math.floor(x + 1e-9));
  const dist = topGradeDist(origin, k);
  if (dist.has(floorS.join('/'))) return { initS: floorS, replaced: false };
  const [key] = [...dist.entries()].sort((a, b) => b[1] - a[1])[0];
  return { initS: key.split('/').map(Number), replaced: true, floorS };
}

const clean = s => String(s ?? '').replace(/[<>]/g, '').trim();

const scraped = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const out = [];
const warn = [];
for (const p of scraped) {
  const base = {
    id: `neon_${p.no}`,
    name: clean(p.name),
    attr: (p.attrs || []).map(a => a[0]).join(''),
    attrs: p.attrs || [],
    obtain: clean([p.category, p.obtain].filter(Boolean).join(': ')),
  };
  const extra = {
    img: p.img || '',
    gradeOff: GRADE_OFF,
    initDec: p.init,
    family: clean(p.family),
    ride: !!p.ride,
    riders: (p.riders || []).map(clean),
    grade: clean(p.grade),
    slots: p.slots ?? null,
    totalGrowth: p.totalGrowth ?? null,
  };
  const hasStats = Array.isArray(p.init) && Array.isArray(p.growth)
    && p.init.length === 4 && p.growth.length === 4
    && [...p.init, ...p.growth].every(x => typeof x === 'number');
  if (!hasStats) {
    warn.push(`${p.name}: 초기치/성장률 없음 -> 계산 미지원`);
    out.push({ ...base, origin: null, k: null, ok: false, approx: true, initS: [0, 0, 0, 0], growthS: p.growth || [0, 0, 0, 0], ...extra });
    continue;
  }
  const f = fit(p.init, p.growth);
  if (!f.exact) {
    warn.push(`${p.name}: 정확 재현 실패 (초기 오차 ${f.eI.toFixed(4)}, 성장 오차 ${f.eG.toFixed(4)}, 밴드 ${f.bandOk ? '일치' : '불일치'}) -> 근사`);
  }
  const { initS, replaced, floorS } = pickInitS(p.init, f.origin, f.k);
  if (replaced) warn.push(`${p.name}: S급 내림값 ${floorS.join('/')} 이 +8 에서 안 나와 ${initS.join('/')} 로 대체`);
  out.push({
    ...base,
    origin: f.origin,
    k: f.k,
    ok: true,
    approx: !f.exact,
    initS,
    growthS: p.growth,
    ...extra,
  });
}

// 새 스크랩에서 빠진 개체는 지우지 않고 직전 빌드 결과를 유지한다(스크랩 일부 누락 대비).
if (fs.existsSync(OUT)) {
  const names = new Set(out.map(p => p.name));
  const kept = JSON.parse(fs.readFileSync(OUT, 'utf8')).filter(p => !names.has(p.name));
  if (kept.length) { out.push(...kept); console.log('목록에서 빠졌지만 유지:', kept.map(p => p.name).join(', ')); }
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
warn.forEach(w => console.warn('  ' + w));
console.log(`변환 완료: ${out.length}마리 (정확 재현 ${out.filter(p => p.ok && !p.approx).length}, 근사 ${out.filter(p => p.approx).length}) -> ${path.relative(path.join(__dirname, '..'), OUT)}`);

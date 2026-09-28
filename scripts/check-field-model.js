#!/usr/bin/env node
/*
 * data/field-samples.json 누적 실측 개체로 계산기 모델을 재검증한다 (읽기 전용, 아무것도 안 바꿈).
 *
 *   node scripts/check-field-model.js      (npm run check:field)
 *
 * 1) 재현성: 각 개체의 초기치가 index.html 의 origin·k 로 만들어지는지 (안 되면 그 종 origin·k 의심)
 * 2) 모델 비교(로그우도): 보너스분배 균등(286가지) vs 다항(1포인트씩 독립) x 등급오프셋 균등 vs 재적합
 *    - 계산기 "실측" 칸은 다항 보너스 + 균등 오프셋. 재적합 W 가 균등보다 크게(ΔLL > ~5) 좋아지면 재검토.
 * 3) 상위 꼬리: 정석 대비 합계 편차 >=0, >=+1 개체 수 실측 vs 모델 기대값
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const petsOf = id => JSON.parse(html.split(`id="${id}">`)[1].split('</script>')[0]);
const PETS = [...petsOf('pet-data'), ...petsOf('pet-data-extra')];
const { samples } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'field-samples.json'), 'utf8'));

const OFF = [-2, -1, 0, 1, 2];
const Ds = [];
for (let a = 0; a <= 10; a++) for (let b = 0; b <= 10 - a; b++) for (let c = 0; c <= 10 - a - b; c++) Ds.push([a, b, c, 10 - a - b - c]);
const F = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800];
const BW = { 균등: Ds.map(() => 1 / Ds.length), 다항: Ds.map(D => F[10] / (F[D[0]] * F[D[1]] * F[D[2]] * F[D[3]]) / 4 ** 10) };
const U = [0.2, 0.2, 0.2, 0.2, 0.2];

const disp = (p, d, D) => {
  const a = d.map((x, j) => p.k * (p.origin[j] + x + D[j]) / 100);
  return [4 * a[0] + a[1] + a[2] + a[3], 0.1 * a[0] + a[1] + 0.1 * a[2] + 0.05 * a[3], 0.1 * a[0] + 0.1 * a[1] + a[2] + 0.05 * a[3], a[3]].map(Math.floor);
};
const eachCombo = fn => { for (const d0 of OFF) for (const d1 of OFF) for (const d2 of OFF) for (const d3 of OFF) { const d = [d0, d1, d2, d3]; Ds.forEach((D, i) => fn(d, D, i)); } };
const wp = (w, d) => w[d[0] + 2] * w[d[1] + 2] * w[d[2] + 2] * w[d[3] + 2];

// 개체별 일치 조합 [(오프셋, 보너스인덱스)] - 같은 종·초기치는 캐시
const cache = new Map();
const data = [];
const noPet = {};
for (const s of samples) {
  const p = PETS.find(q => q.name === s.sp);
  if (!p || !p.ok) { noPet[s.sp] = (noPet[s.sp] || 0) + 1; continue; }
  const key = s.sp + s.raw;
  if (!cache.has(key)) {
    const m = [];
    eachCombo((d, D, i) => { if (disp(p, d, D).every((x, j) => x === s.raw[j])) m.push([d, i]); });
    cache.set(key, m);
  }
  data.push({ s, p, m: cache.get(key) });
}

console.log(`누적 ${samples.length}마리 (계산 대상 ${data.length})`);
if (Object.keys(noPet).length) console.log('  계산기에 없는/미지원 종:', JSON.stringify(noPet));

// 1) 재현성
const fails = {};
data.filter(x => !x.m.length).forEach(x => (fails[x.s.sp] = fails[x.s.sp] || []).push(x.s.raw.join('/')));
console.log('\n[1] 재현 불가:', Object.keys(fails).length ? JSON.stringify(fails) : '0건 (전원 현재 origin·k 로 재현)');

// 2) 로그우도
const ok = data.filter(x => x.m.length);
const LL = (w, bw) => ok.reduce((t, x) => t + Math.log(x.m.reduce((z, [d, i]) => z + wp(w, d) * bw[i], 0)), 0);
const fitW = bw => {
  let w = U.slice();
  for (let it = 0; it < 200; it++) {
    const c = [0, 0, 0, 0, 0];
    for (const x of ok) {
      const z = x.m.reduce((a, [d, i]) => a + wp(w, d) * bw[i], 0);
      for (const [d, i] of x.m) { const r = wp(w, d) * bw[i] / z; d.forEach(v => c[v + 2] += r); }
    }
    const t = c.reduce((a, b) => a + b); w = c.map(v => v / t);
  }
  return w;
};
const wU = fitW(BW.균등), wM = fitW(BW.다항);
const f = w => w.map(v => v.toFixed(3)).join(' ');
console.log('\n[2] 로그우도 (클수록 좋음)');
console.log(`  균등보너스 + 균등오프셋      ${LL(U, BW.균등).toFixed(1)}`);
console.log(`  균등보너스 + 재적합오프셋    ${LL(wU, BW.균등).toFixed(1)}   W=[${f(wU)}]`);
console.log(`  다항보너스 + 균등오프셋 ★    ${LL(U, BW.다항).toFixed(1)}   <- 계산기 "실측"`);
console.log(`  다항보너스 + 재적합오프셋    ${LL(wM, BW.다항).toFixed(1)}   W=[${f(wM)}]  ΔLL=${(LL(wM, BW.다항) - LL(U, BW.다항)).toFixed(1)}`);

// 3) 상위 꼬리 (종별 기대값: 균등오프셋 x 다항보너스)
console.log('\n[3] 정석 대비 합계 편차 상위 꼬리 (실측 / 모델 기대)');
const bySp = {};
ok.forEach(x => (bySp[x.s.sp] = bySp[x.s.sp] || []).push(x));
for (const [sp, arr] of Object.entries(bySp).sort((a, b) => b[1].length - a[1].length)) {
  if (arr.length < 20) continue;
  const p = arr[0].p;
  const P = {};
  eachCombo((d, D, i) => { const v = disp(p, d, D).reduce((a, x, j) => a + x - p.initS[j], 0); P[v] = (P[v] || 0) + wp(U, d) * BW.다항[i]; });
  const exp = lo => Object.entries(P).filter(([k]) => +k >= lo).reduce((a, [, v]) => a + v, 0) * arr.length;
  const obs = lo => arr.filter(x => x.s.raw.reduce((a, v, j) => a + v - p.initS[j], 0) >= lo).length;
  const maxDev = Math.max(...arr.map(x => x.s.raw.reduce((a, v, j) => a + v - p.initS[j], 0)));
  console.log(`  ${sp} n=${arr.length}  >=0: ${obs(0)} / ${exp(0).toFixed(1)}   >=+1: ${obs(1)} / ${exp(1).toFixed(1)}   최대 ${maxDev >= 0 ? '+' : ''}${maxDev}`);
}

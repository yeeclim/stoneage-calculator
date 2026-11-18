#!/usr/bin/env node
// 강화 기대값 테스트: node scripts/test-enhance-calc.js
const assert = require('assert');
const path = require('path');
const { expected, optimal, simulate } = require(path.join(__dirname, '..', 'enhance-calc.js'));
const { rates } = require(path.join(__dirname, '..', 'items.json')).enhance;

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (허용 ${tol})`);
// 시드 고정 난수 (32비트 정수 연산이라 정밀도 손실 없음)
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const B700 = { B: 7_000_000 };

t('+0→+0 은 전부 0', () => {
  const e = expected(rates, 0, 0, 'none');
  for (const k in e) assert.strictEqual(e[k], 0, k);
});

t('+0→+1 은 100% 라 1회·강화비 1회분·파괴 0', () => {
  const e = expected(rates, 0, 1, 'none');
  assert.strictEqual(e.attempts, 1); assert.strictEqual(e.destroys, 0); assert.strictEqual(e.fee, rates[0].cost); assert.strictEqual(e.total, rates[0].cost);
});

t('+0→+4 (파괴 없는 구간)는 Σ1/p, 파괴 0', () => {
  const e = expected(rates, 0, 4, 'none');
  close(e.attempts, rates.slice(0, 4).reduce((s, r) => s + 100 / r.base, 0), 1e-9, '시도');
  close(e.fee, rates.slice(0, 4).reduce((s, r) => s + r.cost * 100 / r.base, 0), 1e-6, '강화비');
  assert.strictEqual(e.destroys, 0);
});

t('+4→+5 단일 파괴 단계: 파괴 기대 (1−p)/p, +0 재시작 시도 포함', () => {
  const e = expected(rates, 4, 5, 'none'); const p = rates[4].base / 100;
  close(e.destroys, (1 - p) / p, 1e-9, '파괴 수'); assert.ok(e.attempts > 1 / p);
});

t('총비용 = 강화비 + 보조제값×시도 + 장비값×파괴 (선형성)', () => {
  const prices = { B: 7_000_000, item: 3_000_000 };
  const e = expected(rates, 0, 8, 'B', prices);
  close(e.total, e.fee + 7_000_000 * e.attempts + 3_000_000 * e.destroys, 1, '총비용');
  assert.strictEqual(e.assists, e.attempts);
});

t('쓰는 등급 값이 없으면 총비용 NaN (0으로 세지 않음)', () => {
  assert.ok(Number.isNaN(expected(rates, 0, 5, 'C', B700).total));
  assert.ok(Number.isFinite(expected(rates, 0, 5, 'none', {}).total));
});

t('보조제가 공짜면 등급이 오를수록 시도·파괴·비용이 모두 준다 (+0→+10)', () => {
  const free = { C: 0, B: 0 };
  const a = expected(rates, 0, 10, 'none', free), c = expected(rates, 0, 10, 'C', free), b = expected(rates, 0, 10, 'B', free);
  for (const k of ['attempts', 'destroys', 'total']) assert.ok(a[k] > c[k] && c[k] > b[k], k);
});

t('B급 700만이면 +0→+7 전 단계 B급은 보조제 없음보다 비싸다 (장비값 0)', () => {
  assert.ok(expected(rates, 0, 7, 'B', B700).total > expected(rates, 0, 7, 'none', B700).total);
});

t('최적 조합은 전부 없음·전부 B 보다 비싸지 않고, 100% 단계(+1)에 보조제를 쓰지 않는다', () => {
  for (const item of [0, 1e6, 1e8, 1e10]) {
    const prices = { ...B700, item };
    const o = optimal(rates, 0, 10, prices);
    assert.ok(o.total <= expected(rates, 0, 10, 'none', prices).total + 1e-6, `item ${item} vs none`);
    assert.ok(o.total <= expected(rates, 0, 10, 'B', prices).total + 1e-6, `item ${item} vs B`);
    assert.strictEqual(o.plan[0], 'none', `item ${item}: +1 은 100%`);
  }
});

t('극단: 보조제가 터무니없이 비싸면 안 쓰고, 장비값이 아주 크면 파괴 단계는 전부 B', () => {
  assert.deepStrictEqual(optimal(rates, 0, 10, { B: 1e12, C: 1e12, item: 0 }).plan, new Array(10).fill('none'));
  // 장비값 0이라도 +8 이상 파괴는 쌓은 강화비를 날리므로 B 700만이 이득 (실측: +8~+10 만 B)
  assert.deepStrictEqual(optimal(rates, 0, 10, { ...B700, item: 0 }).plan, [...new Array(7).fill('none'), 'B', 'B', 'B']);
  const huge = optimal(rates, 0, 10, { ...B700, item: 1e12 }).plan;
  rates.forEach((r, k) => { if (r.destroy) assert.strictEqual(huge[k], 'B', `+${k + 1}`); });
});

t('목표가 높을수록 기대값이 단조 증가', () => {
  let prev = expected(rates, 0, 1, 'none');
  for (let to = 2; to <= 10; to++) {
    const e = expected(rates, 0, to, 'none');
    for (const k of ['attempts', 'fee']) assert.ok(e[k] > prev[k], `${k} +${to}`);
    assert.ok(e.destroys >= prev.destroys); prev = e;
  }
});

t('몬테카를로 20만회와 기대값 1.5% 이내 일치 (단일 등급·혼합 조합·중간 출발)', () => {
  const prices = { B: 7_000_000, C: 3_000_000, item: 2_000_000 };
  const mixed = ['none', 'none', 'none', 'none', 'C', 'C', 'B', 'B'];
  const cases = [[0, 7, 'none'], [0, 7, 'B'], [0, 8, mixed], [6, 8, 'C']];
  const rnd = mulberry32(12345);
  for (const [f, to, plan] of cases) {
    const e = expected(rates, f, to, plan, prices); const N = 200000; const s = { attempts: 0, destroys: 0, fee: 0, total: 0 };
    for (let i = 0; i < N; i++) { const r = simulate(rates, f, to, plan, rnd, prices); for (const k in s) s[k] += r[k]; }
    for (const k in s) close(s[k] / N, e[k], e[k] * 0.015, `${f}→${to} ${plan} ${k}`);
  }
});

const fmt = e => `시도 ${e.attempts.toFixed(1)} · 파괴 ${e.destroys.toFixed(2)} · 총 ${Math.round(e.total).toLocaleString()}S`;
console.log(`\n${n}개 통과.`);
for (const item of [0, 5_000_000]) {
  const p = { ...B700, item };
  const o = optimal(rates, 0, 10, p);
  console.log(`+0→+10 (B 700만, 장비 ${item.toLocaleString()}): 없음 ${fmt(expected(rates, 0, 10, 'none', p))} / 전부B ${fmt(expected(rates, 0, 10, 'B', p))} / 최적[${o.plan.join(',')}] ${fmt(o)}`);
}

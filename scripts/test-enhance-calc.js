#!/usr/bin/env node
// 강화 기대값 테스트: node scripts/test-enhance-calc.js
const assert = require('assert');
const path = require('path');
const { expected, simulate } = require(path.join(__dirname, '..', 'enhance-calc.js'));
const { rates } = require(path.join(__dirname, '..', 'items.json')).enhance;

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (허용 ${tol})`);
// 시드 고정 난수 (32비트 정수 연산이라 정밀도 손실 없음)
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('+0→+0 은 0', () => {
  const e = expected(rates, 0, 0, 'none');
  assert.deepStrictEqual(e, { attempts: 0, destroys: 0, cost: 0 });
});

t('+0→+1 은 100% 라 1회·비용 1회분·파괴 0', () => {
  const e = expected(rates, 0, 1, 'none');
  assert.strictEqual(e.attempts, 1); assert.strictEqual(e.destroys, 0); assert.strictEqual(e.cost, rates[0].cost);
});

t('+0→+4 (파괴 없는 구간)는 Σ1/p, 파괴 0', () => {
  const e = expected(rates, 0, 4, 'none');
  const att = rates.slice(0, 4).reduce((s, r) => s + 100 / r.base, 0);
  const cost = rates.slice(0, 4).reduce((s, r) => s + r.cost * 100 / r.base, 0);
  close(e.attempts, att, 1e-9, '시도'); close(e.cost, cost, 1e-6, '비용'); assert.strictEqual(e.destroys, 0);
});

t('+4→+5 단일 파괴 단계: 파괴 기대 (1−p)/p 와 +0 재시작 비용 포함', () => {
  // +4에서 시작해 실패하면 +0부터 다시 → 파괴 수는 기하분포가 아니라 재시작 포함. 상한·하한으로 확인
  const e = expected(rates, 4, 5, 'none');
  const p = rates[4].base / 100;
  close(e.destroys, (1 - p) / p, 1e-9, '파괴 수'); // 매 실패마다 정확히 1개 파괴, 성공까지 평균 (1−p)/p 회 실패
  assert.ok(e.attempts > 1 / p, '재시작(+0→+4) 시도가 더해져야 함');
});

t('보조제 등급이 오를수록 시도·파괴·비용이 모두 줄어든다 (+0→+10)', () => {
  const a = expected(rates, 0, 10, 'none'), c = expected(rates, 0, 10, 'C'), b = expected(rates, 0, 10, 'B');
  for (const k of ['attempts', 'destroys', 'cost']) { assert.ok(a[k] > c[k] && c[k] > b[k], k); }
});

t('목표가 높을수록 기대값이 단조 증가', () => {
  let prev = expected(rates, 0, 1, 'none');
  for (let to = 2; to <= 10; to++) {
    const e = expected(rates, 0, to, 'none');
    for (const k of ['attempts', 'cost']) assert.ok(e[k] > prev[k], `${k} +${to}`);
    assert.ok(e.destroys >= prev.destroys, `destroys +${to}`);
    prev = e;
  }
});

t('몬테카를로 20만회와 +0→+7 (none/B) 기대값 1% 이내 일치', () => {
  const rnd = mulberry32(12345);
  for (const g of ['none', 'B']) {
    const e = expected(rates, 0, 7, g);
    const N = 200000; const s = { attempts: 0, destroys: 0, cost: 0 };
    for (let i = 0; i < N; i++) { const r = simulate(rates, 0, 7, g, rnd); for (const k in s) s[k] += r[k]; }
    for (const k in s) close(s[k] / N, e[k], e[k] * 0.01, `${g} ${k}`);
  }
});

t('중간 단계 출발(+6→+8)도 몬테카를로와 일치', () => {
  const rnd = mulberry32(999);
  const e = expected(rates, 6, 8, 'C'); const N = 200000; const s = { attempts: 0, destroys: 0, cost: 0 };
  for (let i = 0; i < N; i++) { const r = simulate(rates, 6, 8, 'C', rnd); for (const k in s) s[k] += r[k]; }
  for (const k in s) close(s[k] / N, e[k], e[k] * 0.015, `C ${k}`);
});

const show = (g) => { const e = expected(rates, 0, 10, g); return `시도 ${e.attempts.toFixed(1)} · 파괴 ${e.destroys.toFixed(2)} · ${Math.round(e.cost).toLocaleString()}S`; };
console.log(`\n${n}개 통과. +0→+10 기대: 없음 ${show('none')} / C ${show('C')} / B ${show('B')}`);

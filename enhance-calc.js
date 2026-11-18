/*
 * 장비 강화 기대값 (브라우저: window.EnhanceCalc, node: require).
 *
 * rates: items.json enhance.rates — [{lv, base, C, B, cost, destroy}] (+1~+10)
 * 규칙(공홈 패치노트 260923): 실패 시 destroy=false 단계는 장비·단계 유지, true 단계는 장비 파괴 → 새 장비 +0부터.
 *
 * plan: 단계별 보조제 — 'none' | 'C' | 'B' 하나면 모든 단계 동일, 배열이면 plan[k] = +k→+k+1 에 쓰는 등급.
 * prices: { C, B, item } — 보조제 1개 값, 장비 1개 값(S). 쓰는 등급의 값이 없으면 총비용은 NaN(계산 불가).
 *
 * 상태 k(현재 +k)에서 기대값 E_k 를 E_k = A_k + B_k·E_0 꼴로 뒤에서부터 푼다.
 *   유지 단계: E_k = c/p + E_{k+1}
 *   파괴 단계: E_k = c + p·E_{k+1} + (1−p)·(d + E_0)
 * 같은 식에 (c=1,d=0) → 시도 횟수, (c=0,d=1) → 파괴 개수, (c=강화비+보조제값, d=장비값) → 총비용.
 */
(function (root) {
  'use strict';
  const RATE_KEY = { none: 'base', C: 'C', B: 'B' };
  const gradeAt = (plan, k) => (Array.isArray(plan) ? plan[k] : plan) || 'none';

  function solve(rates, from, to, plan, perTry, perDestroy) {
    const A = new Array(to + 1).fill(0), B = new Array(to + 1).fill(0);
    for (let k = to - 1; k >= 0; k--) {
      const r = rates[k], g = gradeAt(plan, k);
      const p = r[RATE_KEY[g]] / 100, c = perTry(r, g);
      if (!(p > 0)) return Infinity;
      if (!r.destroy) { A[k] = c / p + A[k + 1]; B[k] = B[k + 1]; }
      else { A[k] = c + p * A[k + 1] + (1 - p) * perDestroy; B[k] = p * B[k + 1] + (1 - p); }
    }
    if (from >= to) return 0;
    const E0 = B[0] >= 1 ? Infinity : A[0] / (1 - B[0]);
    return A[from] + B[from] * E0;
  }

  const assistPrice = (prices, g) => g === 'none' ? 0 : (prices && Number.isFinite(prices[g]) ? prices[g] : NaN);

  // from(+from)→to(+to) 평균 시도·파괴·강화비(S)·보조제 개수·총비용(S, 보조제값+장비값 포함)
  function expected(rates, from, to, plan, prices) {
    if (!Array.isArray(rates) || rates.length < to) throw new Error('rates 부족');
    const item = prices && Number.isFinite(prices.item) ? prices.item : 0;
    const used = r => 1;
    const destroys = solve(rates, from, to, plan, () => 0, 1);
    return {
      attempts: solve(rates, from, to, plan, used, 0),
      destroys,
      fee: solve(rates, from, to, plan, r => r.cost, 0),
      assists: solve(rates, from, to, plan, (r, g) => g === 'none' ? 0 : 1, 0),
      total: solve(rates, from, to, plan, (r, g) => r.cost + assistPrice(prices, g), item),
    };
  }

  // 총비용이 가장 낮은 단계별 보조제 조합. 값이 입력된 등급만 후보 (최대 3^10 = 59,049가지 전수 탐색).
  function optimal(rates, from, to, prices) {
    const grades = ['none', ...['C', 'B'].filter(g => Number.isFinite(assistPrice(prices, g)))];
    if (to <= 0) return { plan: [], ...expected(rates, from, to, [], prices) };
    let best = null; const plan = new Array(to).fill('none');
    const n = grades.length ** to;
    for (let i = 0; i < n; i++) {
      let x = i; for (let k = 0; k < to; k++) { plan[k] = grades[x % grades.length]; x = Math.floor(x / grades.length); }
      const total = solve(rates, from, to, plan, (r, g) => r.cost + assistPrice(prices, g), prices && Number.isFinite(prices.item) ? prices.item : 0);
      if (!best || total < best.total - 1e-6) best = { total, plan: plan.slice() };
    }
    return { plan: best.plan, ...expected(rates, from, to, best.plan, prices) };
  }

  // 몬테카를로 1회 (테스트 대조용)
  function simulate(rates, from, to, plan, rnd, prices) {
    const item = prices && Number.isFinite(prices.item) ? prices.item : 0;
    let lv = from, attempts = 0, destroys = 0, fee = 0, total = 0;
    while (lv < to) {
      const r = rates[lv], g = gradeAt(plan, lv);
      attempts++; fee += r.cost; total += r.cost + (prices ? assistPrice(prices, g) : 0);
      if (rnd() * 100 < r[RATE_KEY[g]]) lv++;
      else if (r.destroy) { destroys++; total += item; lv = 0; }
    }
    return { attempts, destroys, fee, total };
  }

  const api = { expected, optimal, simulate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EnhanceCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);

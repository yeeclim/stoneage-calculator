/*
 * 장비 강화 기대값 (브라우저: window.EnhanceCalc, node: require).
 *
 * rates: items.json enhance.rates — [{lv, base, C, B, cost, destroy}] (+1~+10)
 * 규칙(공홈 패치노트 260923): 실패 시 destroy=false 단계는 장비·단계 유지, true 단계는 장비 파괴 → 새 장비 +0부터.
 *
 * 상태 k(현재 +k)에서 기대값 E_k 를 E_k = A_k + B_k·E_0 꼴로 뒤에서부터 푼다.
 *   유지 단계: E_k = c/p + E_{k+1}
 *   파괴 단계: E_k = c + p·E_{k+1} + (1−p)·(d + E_0)
 * 같은 식에 (c=1,d=0) → 시도 횟수, (c=0,d=1) → 파괴 개수, (c=비용,d=0) → 강화비용(S).
 */
(function (root) {
  'use strict';
  const GRADES = { none: 'base', C: 'C', B: 'B' };

  function solve(rates, from, to, grade, perTry, perDestroy) {
    const key = GRADES[grade] || 'base';
    const A = new Array(to + 1).fill(0), B = new Array(to + 1).fill(0);
    for (let k = to - 1; k >= 0; k--) {
      const r = rates[k];
      const p = r[key] / 100, c = perTry(r);
      if (!(p > 0)) return Infinity;
      if (!r.destroy) { A[k] = c / p + A[k + 1]; B[k] = B[k + 1]; }
      else { A[k] = c + p * A[k + 1] + (1 - p) * perDestroy; B[k] = p * B[k + 1] + (1 - p); }
    }
    if (from >= to) return 0;
    const E0 = B[0] >= 1 ? Infinity : A[0] / (1 - B[0]);
    return A[from] + B[from] * E0;
  }

  // from(+from)에서 to(+to)까지 평균 시도 횟수·파괴 개수·강화비용(S). 장비·보조제 구입비는 포함하지 않는다.
  function expected(rates, from, to, grade) {
    if (!Array.isArray(rates) || rates.length < to) throw new Error('rates 부족');
    return {
      attempts: solve(rates, from, to, grade, () => 1, 0),
      destroys: solve(rates, from, to, grade, () => 0, 1),
      cost: solve(rates, from, to, grade, r => r.cost, 0),
    };
  }

  // 몬테카를로 1회 (테스트 대조용)
  function simulate(rates, from, to, grade, rnd) {
    const key = GRADES[grade] || 'base';
    let lv = from, attempts = 0, destroys = 0, cost = 0;
    while (lv < to) {
      const r = rates[lv];
      attempts++; cost += r.cost;
      if (rnd() * 100 < r[key]) lv++;
      else if (r.destroy) { destroys++; lv = 0; }
    }
    return { attempts, destroys, cost };
  }

  const api = { expected, simulate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EnhanceCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);

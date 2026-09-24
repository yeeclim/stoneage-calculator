#!/usr/bin/env node
/*
 * 표기 초기치·성장률 -> origin(원본계수)·k 역산.
 *
 * 모델은 index.html 의 growthForOffsetDB / 초기치 계산과 동일하다:
 *   v_i    = origin_i + 2(등급오프셋) + 2.5(보너스분배)      ... S급 기준 고정
 *   g_i    = v_i * B / 10000,  B = origin 합이 속한 RANKS 밴드의 중앙값
 *   a_i    = k * v_i / 100
 *   표기값 = M · (g 또는 a),  M = [[4,1,1,1],[.1,1,.1,.05],[.1,.1,1,.05],[0,0,0,1]]
 *   표기 초기치는 여기에 floor 적용.
 *
 * 절차: 성장률 4개로 M을 역행렬 풀이해 v 를 얻고, 밴드별 B 로 origin 후보를 만든 뒤
 *       (1) 밴드 자기일관성 (2) 초기치를 재현하는 k 존재 를 요구하고,
 *       반올림 잔차가 가장 작은 해를 채택한다.
 *
 * 기존 165마리 중 162마리를 origin·k 까지 정확 재현(origin 불일치 0건, 해없음 0건).
 * 나머지 3건(페루루/킹북이/철북이)은 저장돼 있던 k 가 자기 초기치를 재현하지 못하던
 * 데이터 오류였고, 이 솔버 값으로 교정했다.
 */
const RANKS = [
  { lo: 100, hi: null, Blo: 450, Bhi: 500 },
  { lo: 95,  hi: 99,   Blo: 470, Bhi: 520 },
  { lo: 90,  hi: 94,   Blo: 490, Bhi: 540 },
  { lo: 85,  hi: 89,   Blo: 510, Bhi: 560 },
  { lo: 80,  hi: 84,   Blo: 530, Bhi: 580 },
  { lo: null,hi: 80,   Blo: 550, Bhi: 600 },
];
const GRADE_OFF = 2, BONUS = 2.5, EPS = 1e-9;

const bandOf = s => RANKS.find(r => (r.lo === null || s >= r.lo) && (r.hi === null || s <= r.hi)) || RANKS[RANKS.length - 1];

const disp = x => [
  4 * x[0] + x[1] + x[2] + x[3],
  0.1 * x[0] + x[1] + 0.1 * x[2] + 0.05 * x[3],
  0.1 * x[0] + 0.1 * x[1] + x[2] + 0.05 * x[3],
  x[3],
];

// M · out = rhs 를 가우스 소거로 푼다.
function solveM(rhs) {
  const M = [[4, 1, 1, 1], [0.1, 1, 0.1, 0.05], [0.1, 0.1, 1, 0.05], [0, 0, 0, 1]];
  const A = M.map((row, i) => [...row, rhs[i]]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const pv = A[c][c];
    for (let j = c; j <= 4; j++) A[c][j] /= pv;
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = A[r][c];
      for (let j = c; j <= 4; j++) A[r][j] -= f * A[c][j];
    }
  }
  return A.map(r => r[4]);
}

// 표기 초기치를 정확히 재현하는 k 를 전부 찾는다 (1~80).
function allK(origin, initS, off = GRADE_OFF) {
  const v = origin.map(o => o + off + BONUS);
  const hits = [];
  for (let k = 1; k <= 80; k++) {
    const d = disp(v.map(x => k * x / 100)).map(x => Math.floor(x + EPS));
    if (d.every((x, i) => x === initS[i])) hits.push(k);
  }
  return hits;
}

/** 후보들을 반올림 잔차 오름차순으로 반환. 첫 원소가 채택해, 빈 배열이면 해 없음. */
function solve(growthS, initS, off = GRADE_OFF) {
  if (!Array.isArray(growthS) || growthS.length !== 4) return [];
  if (!Array.isArray(initS) || initS.length !== 4) return [];
  if (growthS.some(x => typeof x !== 'number' || !isFinite(x))) return [];

  const g = solveM(growthS);
  const cands = [];
  for (const band of RANKS) {
    const B = (band.Blo + band.Bhi) / 2;
    const v = g.map(x => x * 10000 / B);
    const origin = v.map(x => Math.round(x - off - BONUS));
    if (origin.some(o => o < 0)) continue;
    const sum = origin.reduce((a, b) => a + b, 0);
    if (bandOf(sum - 4 * (GRADE_OFF - off)) !== band) continue;   // RANK 구간표는 오프셋 +2 기준 origin 합으로 정의됨 -> 환산                                        // 밴드 자기일관성
    const ks = allK(origin, initS, off);
    if (!ks.length) continue;                                                  // 초기치 재현 k 필수
    const resid = Math.max(...v.map((x, i) => Math.abs(x - off - BONUS - origin[i])));
    const gg = origin.map(o => (o + off + BONUS) * B / 10000);
    const back = disp(gg).map(x => +x.toFixed(3));
    const err = Math.max(...back.map((x, i) => Math.abs(x - growthS[i])));
    cands.push({ origin, sum, B, k: ks[0], ks, resid, err, back });
  }
  cands.sort((a, b) => a.resid - b.resid);
  return cands;
}

module.exports = { solve, allK, disp, RANKS, GRADE_OFF, BONUS };

// CLI: node scripts/solve-origin-k.js "51,10,6,9" "9.761,2.086,1.231,1.734"
if (require.main === module) {
  const [initArg, growthArg] = process.argv.slice(2);
  if (!initArg || !growthArg) {
    console.error('사용법: node scripts/solve-origin-k.js "초기치(내,공,방,순)" "성장률(내,공,방,순)"');
    process.exit(1);
  }
  const initS = initArg.split(',').map(Number);
  const growthS = growthArg.split(',').map(Number);
  const rs = solve(growthS, initS);
  if (!rs.length) { console.log('해 없음 (approx 처리 필요)'); process.exit(0); }
  rs.forEach((r, i) => console.log(
    `${i === 0 ? '★' : ' '} origin=[${r.origin}] 합=${r.sum} B=${r.B} k=${r.k}${r.ks.length > 1 ? `(후보 ${r.ks})` : ''} 잔차=${r.resid.toFixed(4)} 성장률오차=${r.err.toFixed(4)}`));
}

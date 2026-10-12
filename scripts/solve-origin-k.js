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
 *       (1) 밴드 자기일관성 (2) 초기치를 재현하는 k 존재(정석 +8 재현 필수, allK 참고) 를 요구하고,
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

// 표기 스탯 [내구,공격,방어,순발]. 서버(gmsv char.c CHAR_complianceParameter)와 같은
// 연산 순서로 계산한다 - 원값 r = k*work(정수), 표기 = (int)(r*0.01*계수 합). 순서가 다르면
// 부동소수 오차로 내림 결과가 갈린다(펫 432마리 중 69마리 정석 일치 건수가 달랐음).
// v = origin+오프셋+보너스(정수).
function stats(k, v) {
  const r = v.map(x => k * x);
  return [
    Math.trunc((r[0] * 4 + r[1] * 1 + r[2] * 1 + r[3] * 1) * 0.01),
    Math.trunc(r[1] * 0.01 * 1.0 + r[2] * 0.01 * 0.1 + r[0] * 0.01 * 0.1 + r[3] * 0.01 * 0.05),
    Math.trunc(r[2] * 0.01 * 1.0 + r[1] * 0.01 * 0.1 + r[0] * 0.01 * 0.1 + r[3] * 0.01 * 0.05),
    Math.trunc(r[3] * 0.01),
  ];
}

// 보너스 10포인트의 정수 분배 286가지.
const Ds = [];
for (let a = 0; a <= 10; a++) for (let b = 0; b <= 10 - a; b++) for (let c = 0; c <= 10 - a - b; c++) Ds.push([a, b, c, 10 - a - b - c]);

// 정석은 실제 개체로 반드시 나온다 -> 오프셋 전부 +2(최고등급)에서 정석을 만드는 보너스분배가 있어야 한다.
const reachableAtTop = (origin, k, initS) =>
  Ds.some(D => stats(k, origin.map((o, i) => o + GRADE_OFF + D[i])).every((x, i) => x === initS[i]));

// 보너스 평균 2.5 로 표기 초기치를 재현하는 k 를 전부 찾는다 (1~80). origin 후보 선별은 이 기준.
function allK(origin, initS, off = GRADE_OFF) {
  const v = origin.map(o => o + off + BONUS);
  const hits = [];
  for (let k = 1; k <= 80; k++) {
    const d = disp(v.map(x => k * x / 100)).map(x => Math.floor(x + EPS));
    if (d.every((x, i) => x === initS[i])) hits.push(k);
  }
  return hits;
}

// 정석 +8 재현 k 로 보정. 2.5 기준 k 중 +8 재현되는 게 있으면 그것만, 없으면 같은 origin 에서
// +8 재현되는 k 를 2.5 기준 k 에 가까운 순으로 쓴다(카타르카스 22->23, 베노노크 24->23, 후바바 22->21).
function topKs(origin, initS, ks) {
  const ok = ks.filter(k => reachableAtTop(origin, k, initS));
  if (ok.length) return ok;
  const reach = [];
  for (let k = 1; k <= 80; k++) if (reachableAtTop(origin, k, initS)) reach.push(k);
  return reach.sort((a, b) => Math.abs(a - ks[0]) - Math.abs(b - ks[0]));
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
    const ks25 = allK(origin, initS, off);
    if (!ks25.length) continue;                                                // 초기치 재현 k 필수
    const ks = topKs(origin, initS, ks25);
    if (!ks.length) continue;                                                  // 정석 +8 재현 k 필수
    const resid = Math.max(...v.map((x, i) => Math.abs(x - off - BONUS - origin[i])));
    const gg = origin.map(o => (o + off + BONUS) * B / 10000);
    const back = disp(gg).map(x => +x.toFixed(3));
    const err = Math.max(...back.map((x, i) => Math.abs(x - growthS[i])));
    cands.push({ origin, sum, B, k: ks[0], ks, resid, err, back });
  }
  cands.sort((a, b) => a.resid - b.resid);
  return cands;
}

module.exports = { solve, allK, disp, stats, reachableAtTop, Ds, RANKS, GRADE_OFF, BONUS };

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

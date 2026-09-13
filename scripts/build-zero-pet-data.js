/*
 * zero_board23_pets.json (sathezero.com board23 스크랩 결과) -> index.html 의
 * <script id="pet-data-zero"> 에 넣을 최종 pet-data 형식으로 변환.
 *
 * 출력 스키마는 기존 <script id="pet-data"> 와 동일하게 맞춘다 (id, name, attr, attrs,
 * obtain, origin, k, ok, approx, initS, growthS, img). 실측 표본(같은 종 여러 마리)이
 * 없어서 origin/k를 정확히 역산할 수는 없지만, S급 표기 초기치 1개체를 "오프셋 전부 +2,
 * 보너스 평균 2.5"로 가정하고 선형식을 역행렬로 풀어 origin을 근사 추정한다 (k는 기존
 * 정밀 개체 실측 범위 23~28의 중간값 25로 고정). ok:true, approx:true 로 두면 기존
 * 계산기가 이미 이 상태(근사 추정 개체)를 "등급 확률은 참고용" 경고와 함께 정상 계산
 * 로직을 그대로 태우는 구조라 별도 UI 분기 없이 재사용된다.
 * 나중에 실측 포획 표본이 모이면 ohrsa 파이프라인처럼 종별 origin/k 를 제대로 역산해서
 * approx:false 로 승격시키면 된다.
 *
 * 제로 도감 특유의 필드(ride 탑승여부, grade 판매등급, totalGrowth 총성장률)는
 * 참고용으로 같이 넣어둔다. 현재 index.html 렌더링 코드는 이 필드들을 안 쓰지만,
 * 나중에 표시하고 싶어지면 그대로 쓸 수 있다.
 *
 * 사용법: node scripts/build-zero-pet-data.js
 *   -> scripts/zero_pet_data.json 생성
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'zero_board23_pets.json');
const OUT = path.join(__dirname, 'zero_pet_data.json');

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));

const num = s => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

// origin/k 근사 역산 -----------------------------------------------------
// 기존 정밀 개체(pet-data)의 실제 공식: 내구=4a+b+c+d, 공격=0.1a+b+0.1c+0.05d,
// 방어=0.1a+0.1b+c+0.05d, 순발=d (a~d = k*(origin_i+offset_i+bonus_i)/100).
// 제로 도감엔 종당 S급(=offset 전부 +2, bonus 평균 2.5로 가정) 표기 초기치 1개뿐이라
// origin/k를 유일하게 못 구한다(방정식 4개, 미지수 origin*4+k=5개). 그래서 k는 기존
// 정밀 개체들의 실측 범위(23~28)의 중간값 25로 고정해두고 origin만 역산한다.
// -> 실측 표본이 아니라 단일 S급 표기값 기반 추정치이므로 부정확할 수 있음.
const K_ASSUMED = 25;

function solveA(S) {
  // S = [내구,공격,방어,순발] (표기 초기치, 정수) -> a0~a3 역산 (floor로 인한 오차 있음)
  const a3 = S[3];
  const RHS0 = S[0] - a3;
  const RHS1 = S[1] - 0.05 * a3;
  const RHS2 = S[2] - 0.05 * a3;
  const a0 = (1.1 * RHS0 - RHS1 - RHS2) / 4.2;
  const a2 = (RHS0 - RHS1 - 3.9 * a0) / 0.9;
  const a1 = RHS0 - 4 * a0 - a2;
  return [a0, a1, a2, a3];
}

// computeGradeDist(index.html)와 동일한 보너스분배 전체 목록(10을 4칸에 나누는
// 정수 조합, 286가지). "오프셋 전부 +2(=S급 최고등급)"에서 이 중 하나라도 표기
// 초기치와 내림 일치해야, 계산기에서 이 펫을 고르자마자 "일치하는 조합 없음"이
// 뜨지 않는다.
const Ds = [];
for (let a = 0; a <= 10; a++) for (let b = 0; b <= 10 - a; b++) for (let c = 0; c <= 10 - a - b; c++) {
  Ds.push([a, b, c, 10 - a - b - c]);
}

function existsExactMatchAtTop(origin, k, target) {
  for (const D of Ds) {
    const v0 = origin[0] + 2 + D[0], v1 = origin[1] + 2 + D[1], v2 = origin[2] + 2 + D[2], v3 = origin[3] + 2 + D[3];
    const a0 = (k * v0) / 100, a1 = (k * v1) / 100, a2 = (k * v2) / 100, a3 = (k * v3) / 100;
    if (Math.floor(a3) !== target[3]) continue;
    if (Math.floor(0.1 * a0 + a1 + 0.1 * a2 + 0.05 * a3) !== target[1]) continue;
    if (Math.floor(0.1 * a0 + 0.1 * a1 + a2 + 0.05 * a3) !== target[2]) continue;
    if (Math.floor(4 * a0 + a1 + a2 + a3) !== target[0]) continue;
    return true;
  }
  return false;
}

function estimateOrigin(initS) {
  const a = solveA(initS);
  // a_i = k*(origin_i + 2 + 2.5)/100  ->  origin_i = 100*a_i/k - 4.5 (연속 근사치)
  const base = a.map(ai => Math.max(0, Math.round((100 * ai) / K_ASSUMED - 4.5)));

  // solveA는 initS가 이미 내림된 정수라 소수부 정보를 잃은 채로 역산해서, base를
  // 그대로 쓰면 178,750가지 조합(오프셋×보너스분배) 중 단 하나도 표기 초기치를
  // 정확히 재현 못 할 때가 있다 — 그러면 계산기에서 "일치하는 조합이 없습니다"만
  // 뜬다. base에서 가까운 순서로(맨해튼 거리 오름차순) origin을 훑으면서, "오프셋
  // 전부 +2"에서 실제로 일치하는 보너스분배가 존재하는 첫 origin을 채택한다.
  const R = 6;
  for (let dist = 0; dist <= 4 * R; dist++) {
    for (let d0 = -R; d0 <= R; d0++) for (let d1 = -R; d1 <= R; d1++)
      for (let d2 = -R; d2 <= R; d2++) for (let d3 = -R; d3 <= R; d3++) {
        if (Math.abs(d0) + Math.abs(d1) + Math.abs(d2) + Math.abs(d3) !== dist) continue;
        const o = [base[0] + d0, base[1] + d1, base[2] + d2, base[3] + d3];
        if (o.some(v => v < 0)) continue;
        if (existsExactMatchAtTop(o, K_ASSUMED, initS)) return o;
      }
  }
  return base; // 이론상 도달 안 함(항상 근처에서 찾힘) — 안전망
}

const idSeen = new Set();
function makeId(no) {
  let id = `zero_${no}`;
  if (!idSeen.has(id)) { idSeen.add(id); return id; }
  let i = 2;
  while (idSeen.has(`${id}_${i}`)) i++;
  id = `${id}_${i}`;
  idSeen.add(id);
  return id;
}

const out = raw.map(p => {
  const attrs = (p.elements || [])
    .filter(e => e.attr)
    .map(e => [e.attr, e.level]);
  const attr = attrs.map(a => a[0]).join('');

  // 환생 최상위체 등 일부는 원본 사이트 자체에 초기치가 "-"로 비어있다 (실제 0이 아님).
  const hasRealInit = ['내구력', '공격력', '방어력', '순발력']
    .some(k => /\d/.test(p.init?.[k] || ''));

  const initS = [
    num(p.init?.['내구력']),
    num(p.init?.['공격력']),
    num(p.init?.['방어력']),
    num(p.init?.['순발력']),
  ];
  const growthS = [
    num(p.growth?.['내구력']),
    num(p.growth?.['공격력']),
    num(p.growth?.['방어력']),
    num(p.growth?.['순발력']),
  ];

  const origin = hasRealInit ? estimateOrigin(initS) : null;

  return {
    id: makeId(p.no),
    name: p.name,
    attr,
    attrs,
    obtain: p.route || '',
    origin,
    k: hasRealInit ? K_ASSUMED : null,
    ok: hasRealInit,
    approx: true,
    initS,
    growthS,
    img: p.img || '',
    ride: p.ride || '',
    grade: p.grade || '',
    totalGrowth: p.totalGrowth || null,
  };
});

fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
console.log('변환 완료:', out.length, '마리 ->', OUT);

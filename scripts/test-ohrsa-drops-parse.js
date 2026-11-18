#!/usr/bin/env node
// 확률표 파서 테스트: node scripts/test-ohrsa-drops-parse.js
const assert = require('assert');
const P = require('./ohrsa-drops-parse');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('슬래시 목록: 공백 없는 "이름(1%)" 도 읽는다', () => {
  const e = P.parseSlashList('1 레이드 포인트 (94.5%) / 페트병(흑기린) (2.5%) / 초신성 갑옷(1%)');
  assert.deepStrictEqual(e, [{ name: '1 레이드 포인트', pct: 94.5 }, { name: '페트병(흑기린)', pct: 2.5 }, { name: '초신성 갑옷', pct: 1 }]);
});

t('슬래시 목록: 확률 없는 항목은 예외', () => {
  assert.throws(() => P.parseSlashList('레이드 포인트 1 (93%) / 헤티아의 창'));
});

t('대괄호 목록: ▲▼·신규 추가 표기', () => {
  const e = P.parseBracketList('경험치 구슬 1시간 [30%] (▼ 10%) 초기화 구슬 [25%] 강화석 [10%] (신규 추가) (1)레이드 포인트 [42%]');
  assert.deepStrictEqual(e, [
    { name: '경험치 구슬 1시간', pct: 30, delta: -10 }, { name: '초기화 구슬', pct: 25 },
    { name: '강화석', pct: 10, isNew: true }, { name: '(1)레이드 포인트', pct: 42 }]);
});

t('대괄호 목록: 뒤에 해석 못 한 텍스트가 남으면 예외', () => {
  assert.throws(() => P.parseBracketList('초기화 구슬 [25%] 이상한 꼬리'));
});

t('확률 셀', () => {
  assert.deepStrictEqual(P.parsePctCell('3% (▲ 2%)'), { pct: 3, delta: 2 });
  assert.deepStrictEqual(P.parsePctCell('34% (▼ 6%)'), { pct: 34, delta: -6 });
  assert.deepStrictEqual(P.parsePctCell('0.8%'), { pct: 0.8 });
  assert.throws(() => P.parsePctCell('약 3%'));
});

t('합 검사: 100% 아니면 예외, 부동소수 오차는 허용', () => {
  assert.throws(() => P.checkSum([{ pct: 50 }, { pct: 40 }], 'x'));
  P.checkSum([{ pct: 93.4 }, { pct: 2.5 }, { pct: 1.5 }, { pct: 1 }, { pct: 0.7 }, { pct: 0.5 }, { pct: 0.4 }], 'x');
});

t('변경 전 표 복원 (고대의 제단: 경험치1h 40%, 강화석 없음 → 합 100)', () => {
  const now = P.parseBracketList('경험치 구슬 1시간 [30%] (▼ 10%) 초기화 구슬 [25%] 경험치 구슬 2시간 [15%] 강화석 [10%] (신규 추가) 자동회복고기 1만 [10%] 경험치 구슬 3시간 [5%] 5EP 교환권 [4%] 도르도르 페트병 [1%]');
  const prev = P.previousFromDeltas(now, '고대');
  assert.strictEqual(prev.find(e => e.name === '경험치 구슬 1시간').pct, 40);
  assert.ok(!prev.some(e => e.name === '강화석'));
  assert.strictEqual(P.previousFromDeltas([{ name: 'a', pct: 100 }], 'x'), null);
});

t('능력치 설명 제거 + 아이템 연결 (띄어쓰기·별칭)', () => {
  assert.strictEqual(P.stripStats('기계창 (공+58 순-11 크리+6)'), '기계창');
  assert.strictEqual(P.stripStats('사냥꾼의 활 (공+26 방-16 (x5~6)'), '사냥꾼의 활');
  assert.strictEqual(P.stripStats('페트병(흑기린)'), '페트병(흑기린)');
  const match = P.makeItemMatcher([{ id: '1', name: '얼음 옷' }, { id: '2', name: '강화 보조제(C급)' }, { id: '3', name: '검은 불꽃 장궁' }, { id: '4', name: '삼위일체(眞) 심장' }]);
  assert.strictEqual(match('얼음옷'), '1'); assert.strictEqual(match('C급 보조제'), '2');
  assert.strictEqual(match('검은불꽃 장궁'), '3'); assert.strictEqual(match('삼위일체(眞)의 심장'), '4');
  assert.strictEqual(match('페트병(흑기린)'), null);
  const m2 = P.makeItemMatcher([{ id: '9', name: '경험치 구슬' }, { id: '8', name: '강화 보조제(B)' }]);
  assert.strictEqual(m2('경험치 구슬 2시간'), '9'); assert.strictEqual(m2('경험치 구슬 (1시간)'), '9');
  assert.strictEqual(m2('강화 보조제(B급)'), '8'); assert.strictEqual(m2('B급 보조제'), '8');
});

console.log(`\n${n}개 통과.`);

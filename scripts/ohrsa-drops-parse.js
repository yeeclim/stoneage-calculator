/*
 * 공홈 확률표 텍스트 → 구조화 (scrape-ohrsa-items.playwright.js 가 사용, test-ohrsa-drops-parse.js 로 테스트).
 * 모든 확률표는 합이 100% 인지 검사하고, 아니면 예외를 던진다 (부분 파싱된 표를 배포하지 않기 위함).
 */
'use strict';

const num = s => Number(String(s).replace(/,/g, ''));

// "레이드 포인트 1 (93.4%) / 초신성 갑옷(1%)" → [{name, pct}]
function parseSlashList(text) {
  return text.split(/\s+\/\s+/).map(part => {
    const m = part.trim().match(/^(.*?)\s*\((\d+(?:\.\d+)?)%\)$/);
    if (!m) throw new Error(`확률 항목 해석 실패: "${part}"`);
    return { name: m[1].trim(), pct: num(m[2]) };
  });
}

// "경험치 구슬 1시간 [30%] (▼ 10%) 초기화 구슬 [25%] 강화석 [10%] (신규 추가)" → [{name, pct, delta?, isNew?}]
function parseBracketList(text) {
  const out = []; const re = /\s*(.+?)\s*\[(\d+(?:\.\d+)?)%\]\s*(?:\((▲|▼)\s*(\d+(?:\.\d+)?)%\)|\((신규 추가)\))?/gy;
  let m, last = 0;
  while ((m = re.exec(text))) {
    const e = { name: m[1].trim(), pct: num(m[2]) };
    if (m[3]) e.delta = (m[3] === '▲' ? 1 : -1) * num(m[4]);
    if (m[5]) e.isNew = true;
    out.push(e); last = re.lastIndex;
  }
  if (text.slice(last).trim()) throw new Error(`확률 목록 뒤에 해석 못 한 텍스트: "${text.slice(last).trim()}"`);
  return out;
}

// "3% (▲ 2%)" → {pct:3, delta:2}
function parsePctCell(text) {
  const m = text.trim().match(/^(\d+(?:\.\d+)?)%(?:\s*\((▲|▼)\s*(\d+(?:\.\d+)?)%\))?$/);
  if (!m) throw new Error(`확률 셀 해석 실패: "${text}"`);
  const o = { pct: num(m[1]) };
  if (m[2]) o.delta = (m[2] === '▲' ? 1 : -1) * num(m[3]);
  return o;
}

// 표 이름 뒤 능력치 설명 "(공+58 순-11 크리+6)" 제거
const stripStats = s => s.replace(/\s*\((?=[^)]*[+-]\d)[^)]*\)?\s*$/, '').trim();

function checkSum(entries, label) {
  const sum = entries.reduce((s, e) => s + e.pct, 0);
  if (Math.abs(sum - 100) > 0.11) throw new Error(`${label} 확률 합 ${sum.toFixed(2)}% (100% 아님)`);
  return entries;
}

// ▲▼·신규 표기로 변경 전 표를 되살린다. 되살린 표도 합 100% 여야 한다.
function previousFromDeltas(entries, label) {
  if (!entries.some(e => e.delta || e.isNew)) return null;
  const prev = entries.filter(e => !e.isNew).map(e => ({ name: e.name, pct: Math.round((e.pct - (e.delta || 0)) * 100) / 100 }));
  return checkSum(prev, `${label} (변경 전)`);
}

// 아이템 이름 연결: 띄어쓰기 무시 + 표기 차이 별칭
const ALIAS = {
  // 아이템 도감 표기: 강화 보조제(D급)/(C급)/(B) — B만 '급'이 없다
  'C급보조제': '강화보조제(C급)', 'B급보조제': '강화보조제(B)', 'D급보조제': '강화보조제(D급)',
  '강화보조제D급': '강화보조제(D급)', '강화보조제C급': '강화보조제(C급)', '강화보조제B급': '강화보조제(B)', '강화보조제(B급)': '강화보조제(B)',
  '삼위일체(眞)의심장': '삼위일체(眞)심장',
  '히든초기화구슬': '페트히든초기화구슬', '초기화구슬1개': '초기화구슬',
  '부족경험치구슬(30분)': '부족월드경험치', // 도감 설명: 30분간 부족원 경험치 +100%, 족장 전용
};
// 시간만 다른 경험치 구슬(1·2·3시간)은 도감에 '경험치 구슬' 하나로 올라가 있다
const PREFIX = [[/^경험치구슬(\(?\d+시간\)?)$/, '경험치구슬']];
function makeItemMatcher(items) {
  const byKey = new Map();
  for (const it of items) { const k = it.name.replace(/\s+/g, ''); if (!byKey.has(k)) byKey.set(k, it.id); }
  return name => {
    let k = stripStats(name).replace(/\s+/g, '');
    k = ALIAS[k] || k;
    for (const [re, to] of PREFIX) if (re.test(k)) k = to;
    return byKey.get(k) || null;
  };
}

module.exports = { parseSlashList, parseBracketList, parsePctCell, stripStats, checkSum, previousFromDeltas, makeItemMatcher };

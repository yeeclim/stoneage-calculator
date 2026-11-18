/*
 * 공홈 확률표 수집 (로그인된 Playwright page 를 받아 drops 구조를 돌려준다).
 * 출처:
 *   /raid          - 레이드별 현재 전리품 확률, 입장 조건, 횟수 제한
 *   /update/6, /7  - 레이드 신설 당시 확률 (현재와 다르면 이력으로 기록)
 *   /update/8      - 은빛상자 구성, 페트 자판기 (패치노트 261008)
 *   /update/9      - 필드 레이드(기계군단) 전리품 최초 확률
 *   /update/11     - 필드 레이드 확률 변경, 고대의 제단·크로아치 전리품 개편
 *   /quest         - 페트 의뢰소 보따리
 */
'use strict';
const P = require('./ohrsa-drops-parse');

const BASE = 'https://ohrsa.net';
const URLS = {
  raid: `${BASE}/raid`, quest: `${BASE}/quest`,
  u6: `${BASE}/update/6`, u7: `${BASE}/update/7`, u8: `${BASE}/update/8`, u9: `${BASE}/update/9`, u11: `${BASE}/update/11`,
};

// 브라우저 안: 본문 텍스트, 패치 번호, 표(행 텍스트 + 표 바로 앞 텍스트)
function dumpPage() {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const root = document.querySelector('#bo_v_con, .view_content, #bo_v, main, #container') || document.body;
  const tables = [...root.querySelectorAll('table')].map(t => {
    const r = document.createRange(); r.setStart(root, 0); r.setEndBefore(t);
    return { before: norm(r.toString()).slice(-400), rows: [...t.querySelectorAll('tr')].map(tr => [...tr.children].map(c => norm(c.textContent))) };
  });
  const text = norm(root.textContent);
  const patch = (norm(document.body.textContent).match(/패치노트\s*(\d{6})/) || [])[1] || null;
  return { text, patch, tables };
}

function dumpRaid() {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  return [...document.querySelectorAll('.raid_panel')].map(p => {
    const dash = {};
    for (const c of p.querySelectorAll('.rs_col')) dash[norm(c.querySelector('.rs_title')?.textContent)] = norm(c.querySelector('.rs_value')?.textContent);
    const reset = norm([...p.querySelectorAll('.rs_col div')].map(d => d.textContent).find(t => /⏱/.test(t)) || '').replace(/^⏱️?\s*/, '');
    const h4 = [...p.querySelectorAll('h4')].map(h => norm(h.textContent)).find(t => /전리품/.test(t)) || '';
    const desc = p.querySelector('.patch_desc');
    const list = desc ? norm((desc.querySelector('span') || desc).textContent).replace(/^\[획득 가능 아이템 및 확률\]\s*/, '') : '';
    return { title: norm(p.querySelector('.rh_title')?.textContent), dash, reset, box: h4.replace(/^클리어 보상\s*/, ''), list };
  });
}

// "주 15회" → {n:15, per:'주'}, "1일 1회" → {n:1, per:'일'}
function parseLimit(s) {
  let m = (s || '').match(/주\s*(\d+)\s*회/); if (m) return { n: +m[1], per: '주' };
  m = (s || '').match(/(\d+)\s*일\s*(\d+)\s*회/); if (m) return { n: +m[2] / +m[1], per: '일' };
  return null;
}

// "…교만의 방 보상: a (1%) / b (2%) 주간 레이드 …" 에서 anchor 뒤 슬래시 목록만 잘라낸다
function listAfter(text, anchorRe) {
  const m = text.match(anchorRe); if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const parts = rest.split(/\s+\/\s+/), keep = [];
  for (const part of parts) {
    const mm = part.match(/^(.*?\(\d+(?:\.\d+)?%\))/);
    if (!mm) break;
    keep.push(mm[1]);
    if (mm[1].length < part.trim().length) break; // 뒤에 다른 문장이 붙어 있으면 여기서 끝
  }
  return keep.length ? P.parseSlashList(keep.join(' / ')) : null;
}

const findTable = (pg, head) => pg.tables.find(t => t.rows[0] && t.rows[0].join('|') === head);
// "1 레이드 포인트" = "레이드 포인트 1" = "(1)레이드 포인트" 처럼 표기만 다른 이름은 같게 본다
const nameKey = n => n.replace(/\s+/g, '').replace(/^\(?1\)?(?=레이드포인트)/, '').replace(/(레이드포인트)1$/, '$1');
const sameEntries = (a, b) => a.length === b.length && a.every((e, i) => nameKey(e.name) === nameKey(b[i].name) && e.pct === b[i].pct);

async function scrapeDrops(page, gotoRetry, items) {
  const pages = {};
  for (const [k, url] of Object.entries(URLS)) {
    await gotoRetry(page, url);
    if (/login\.php|password\.php/.test(page.url())) throw new Error(`${url} 접근 실패 (로그인 필요)`);
    pages[k] = k === 'raid' ? await page.evaluate(dumpRaid) : await page.evaluate(dumpPage);
  }
  const match = P.makeItemMatcher(items);
  const sources = [];
  const add = s => {
    P.checkSum(s.entries, s.name);
    // 이전 표에서 이름 뒤에 설명이 붙은 품목("부족경험치구슬 (30분) 사용 시 …")은 현재 이름으로 맞춘다
    for (const h of s.history || []) for (const e of h.entries) {
      const cur = s.entries.find(c => c.name !== e.name && e.name.startsWith(c.name + ' '));
      if (cur) e.name = cur.name;
    }
    for (const h of s.history || []) P.checkSum(h.entries, `${s.name} (${h.patch})`);
    for (const e of s.entries) { const id = match(e.name); if (id) e.itemId = id; }
    sources.push(s);
  };

  // 1) 레이드 (현재 확률은 /raid, 신설 당시는 패치노트)
  const raidOld = [
    { page: pages.u6, patch: pages.u6.patch }, { page: pages.u7, patch: pages.u7.patch },
  ];
  const altarPanel = pages.raid.find(r => /고대의 제단/.test(r.title));
  for (const r of pages.raid) {
    if (!r.list) continue;
    const room = (r.title.match(/\[(.+?)\]/) || [])[1] || r.title;
    const entries = P.parseSlashList(r.list);
    const history = [];
    for (const o of raidOld) {
      const old = listAfter(o.page.text, new RegExp(`${room.replace(/[[\]()]/g, '\\$&')}\\s*(?:\\[[^\\]]*\\]\\s*)?보상:\\s*`));
      if (old && !sameEntries(old, entries)) history.push({ patch: o.patch, entries: old });
    }
    add({
      id: `raid:${room}`, kind: 'raid', name: r.title, box: r.box, cond: r.dash['입장 조건'] || '',
      limit: r.dash['횟수 제한'] || '', reset: r.reset, perPeriod: parseLimit(r.dash['횟수 제한']), url: URLS.raid, entries, history,
    });
  }

  // 2) 고대의 제단 · 크로아치 (패치노트 261105 표, ▲▼로 변경 전 복원)
  const ac = findTable(pages.u11, '고대의 제단 전리품|크로아치 전리품');
  if (!ac || !ac.rows[1]) throw new Error('고대의 제단·크로아치 표를 찾지 못함');
  const mk = (cell, label) => { const now = P.parseBracketList(cell); const prev = P.previousFromDeltas(now, label); return { now, prev }; };
  const altar = mk(ac.rows[1][0], '고대의 제단'), cro = mk(ac.rows[1][1], '크로아치');
  add({
    id: 'raid:고대의 제단', kind: 'raid', name: '고대의 제단', box: '고대의 제단 전리품',
    cond: altarPanel ? altarPanel.dash['입장 조건'] : '', limit: altarPanel ? altarPanel.dash['횟수 제한'] : '',
    reset: altarPanel ? altarPanel.reset : '', perPeriod: altarPanel ? parseLimit(altarPanel.dash['횟수 제한']) : null,
    url: URLS.u11, patch: pages.u11.patch, entries: altar.now, history: altar.prev ? [{ patch: `${pages.u11.patch} 이전`, entries: altar.prev }] : [],
  });
  // 크로아치 전리품 = 편견의 방(일일 레이드) 보상 상자. /raid 페이지는 261105 개편 전 확률을 그대로 보여 주므로
  // 더 최근 공지인 패치노트 표를 현재 값으로 쓴다.
  const pre = sources.find(x => /크로아치/.test(x.box));
  if (!pre) throw new Error('크로아치 전리품을 주는 레이드를 /raid 에서 찾지 못함');
  if (!sameEntries(pre.entries, cro.now)) console.warn(`  /raid 의 ${pre.name} 확률이 패치노트 ${pages.u11.patch} 와 다름 → 패치노트 값 사용`);
  pre.entries = cro.now.map(e => { const id = match(e.name); return id ? { ...e, itemId: id } : e; });
  P.checkSum(pre.entries, pre.name);
  pre.url = URLS.u11; pre.patch = pages.u11.patch;
  pre.history = cro.prev ? [{ patch: `${pages.u11.patch} 이전`, entries: cro.prev }] : [];

  // 3) 필드 레이드 기계군단 (261028 최초 → 261105 변경)
  const fNow = findTable(pages.u11, '아이템명 및 효과|변경 획득 확률');
  const fOld = findTable(pages.u9, '아이템명 및 효과|획득 확률');
  if (!fNow || !fOld) throw new Error('필드 레이드 전리품 표를 찾지 못함');
  const rowsToEntries = t => t.rows.slice(1).map(([name, pct]) => ({ name: P.stripStats(name), ...P.parsePctCell(pct) }));
  const fieldNow = rowsToEntries(fNow).map(({ delta, ...e }) => (delta ? { ...e, delta } : e));
  add({
    id: 'field:기계군단', kind: 'field', name: '필드 레이드 (기계군단)', box: '테이토스·테르가·테이노스 처치 전리품',
    note: '고유 보스 페트병은 처치한 보스의 페트병', url: URLS.u11, patch: pages.u11.patch,
    entries: fieldNow, history: [{ patch: pages.u9.patch, entries: rowsToEntries(fOld) }],
  });

  // 4) 은빛상자 · 페트 자판기 (261008)
  const box = findTable(pages.u8, '구성 품목|획득 확률');
  if (!box) throw new Error('은빛상자 표를 찾지 못함');
  const shop = box.before.match(/판매처:\s*(.+?)\s*\/\s*판매 가격:\s*(.+?)$/);
  add({
    id: 'box:은빛상자', kind: 'box', name: '은빛상자', box: shop ? `${shop[1]} · ${shop[2]}` : '', url: URLS.u8, patch: pages.u8.patch,
    entries: box.rows.slice(1).map(([name, pct]) => ({ name: P.stripStats(name), ...P.parsePctCell(pct) })),
  });
  const vend = findTable(pages.u8, '페트 이름|획득 확률|페트 이름|획득 확률');
  if (!vend) throw new Error('페트 자판기 표를 찾지 못함');
  const vEntries = [];
  for (const r of vend.rows.slice(1)) for (let i = 0; i + 1 < r.length; i += 2) if (r[i]) vEntries.push({ name: r[i], ...P.parsePctCell(r[i + 1]) });
  const loc = vend.before.match(/위치:\s*(.+?\])/);
  add({ id: 'box:페트 자판기', kind: 'box', name: '페트 자판기', box: `${loc ? loc[1] + ' · ' : ''}페트 코인 1개`, url: URLS.u8, patch: pages.u8.patch, entries: vEntries });

  // 5) 페트 의뢰소 보따리 (퀘스트 가이드)
  const qm = pages.quest.text.match(/보따리 오픈 시 획득 품목 \(랜덤 1종\)\s*((?:•\s*[^•]+?\(\d+(?:\.\d+)?%\)\s*)+)/);
  if (!qm) throw new Error('의뢰소 보따리 확률을 찾지 못함');
  add({
    id: 'quest:의뢰소 보따리', kind: 'box', name: '공룡 조사원의 보따리', box: '페트 의뢰소 일일 퀘스트 보상', perPeriod: { n: 1, per: '일' }, url: URLS.quest,
    entries: P.parseSlashList(qm[1].split('•').map(s => s.trim()).filter(Boolean).join(' / ')),
  });

  const unmatched = [...new Set(sources.flatMap(s => s.entries.filter(e => !e.itemId).map(e => e.name)))];
  return { sources, unmatched };
}

module.exports = { scrapeDrops };

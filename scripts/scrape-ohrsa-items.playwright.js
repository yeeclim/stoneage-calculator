#!/usr/bin/env node
/*
 * ohrsa.net 아이템 도감(/item) 스크레이퍼 (Playwright, 로그인 필요).
 *
 * 출력 (강화 단계별 능력치는 패치노트 260923 표에서 함께 수집 → items.json 의 enhance):
 * 출력:
 *   items.json            - 아이템 목록 (공홈 순서 = 최신순)
 *   images/items/<id>.png - 썸네일 (이미 받은 파일은 건너뜀)
 *
 * 필요 환경변수: OHRSA_USERNAME, OHRSA_PASSWORD
 *   (없으면 scripts/ohrsa.local.env 에서 읽는다)
 *
 * 사용법: npm run scrape:items
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'items.json');
const IMG_DIR = path.join(ROOT, 'images', 'items');
const LOGIN_URL = 'https://ohrsa.net/bbs/login.php';
const ITEM_URL = 'https://ohrsa.net/item';
// 장비 강화 시스템 도입 공지 (패치노트 260923). 단계별 능력치 표는 여기에만 있다.
const ENH_URL = 'https://ohrsa.net/update/7';

function loadEnv() {
  const f = path.join(__dirname, 'ohrsa.local.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(\w+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

async function gotoRetry(page, url, tries = 4) {
  for (let i = 1; ; i++) {
    try { return await page.goto(url, { waitUntil: 'load', timeout: 60000 }); }
    catch (e) { if (i >= tries) throw e; console.warn(`goto 재시도 ${i}/${tries - 1}: ${url}`); }
  }
}

// 브라우저 안에서 실행: 카드 DOM → 원문 문자열만 뽑는다 (해석은 node 쪽 parseStat).
function scrapeCards() {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  return [...document.querySelectorAll('.item_card_item')].map(el => {
    const stats = {};
    const cells = [...el.querySelectorAll('.item_stats_table th')];
    for (const th of cells) stats[norm(th.textContent)] = norm(th.nextElementSibling?.textContent);
    return {
      id: el.dataset.wrId,
      name: norm(el.querySelector('.item_name_title')?.textContent) || el.dataset.name,
      cat: norm(el.querySelector('.item_badge')?.textContent) || el.dataset.cat,
      obtain: norm(el.querySelector('.item_obtain_info')?.textContent).replace(/^획득\s*[:：]\s*/, ''),
      desc: norm(el.querySelector('.item_desc_area')?.textContent),
      img: el.querySelector('.item_img_area img')?.src || el.dataset.img || '',
      stats
    };
  });
}

const STAT_KEYS = { '공': 'atk', '방': 'def', '순': 'agi', '내': 'hp', '크리': 'crit', '회피': 'evas', '명중': 'acc', '관통': 'pen', '쉴드': 'shld' };

// "+60~68" → [60,68], "-25~30" → [-30,-25] (앞 부호가 양끝에 적용), "-4~-8" → [-8,-4],
// "방-15~17" (공홈 오타: 앞 글자) → [-17,-15], "+4~6%" → [4,6] + pct. 해석 실패는 null.
function parseStat(raw) {
  if (!raw || raw === '-') return null;
  const s = raw.replace(/^[^\d+\-]+/, '').replace(/\s+/g, '');
  const m = s.match(/^([+-])?(\d+)(%)?(?:~([+-])?(\d+)(%)?)?$/);
  if (!m) return { raw, n: null, pct: false };
  const sg1 = m[1] === '-' ? -1 : 1;
  const a = sg1 * +m[2];
  const b = m[5] == null ? a : (m[4] ? (m[4] === '-' ? -1 : 1) : sg1) * +m[5];
  return { raw, n: [Math.min(a, b), Math.max(a, b)], pct: !!(m[3] || m[6]) };
}

function normalize(c) {
  const s = {}, n = {}, pct = [], unparsed = [];
  for (const [ko, key] of Object.entries(STAT_KEYS)) {
    const p = parseStat(c.stats[ko]);
    if (!p) continue;
    s[key] = p.raw;
    if (p.n) n[key] = p.n; else unparsed.push(`${ko}=${p.raw}`);
    if (p.pct) pct.push(key);
  }
  const attr = c.stats['속성'] && c.stats['속성'] !== '-' ? c.stats['속성'] : '';
  if (unparsed.length) console.warn(`  수치 해석 실패 [${c.id} ${c.name}]: ${unparsed.join(', ')}`);
  const it = { id: c.id, name: c.name, cat: c.cat, obtain: c.obtain, desc: c.desc, attr, s, n, pct, src: c.img };
  const enh = enhanceKind(it);
  if (enh) it.enh = enh;
  return it;
}

// 브라우저 안에서 실행: "강화단계" 머리글로 시작하는 표들의 행 텍스트와 바로 앞 제목.
function scrapeEnhanceTables() {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  return [...document.querySelectorAll('table')].map(t => {
    const rows = [...t.querySelectorAll('tr')].map(tr => [...tr.children].map(c => norm(c.textContent)));
    // 표 앞쪽 텍스트에서 "무기류 강화 능력치 (도끼, ...)" 같은 제목을 찾는다
    let title = '', n = t;
    while (n && !title) {
      while (n && !n.previousElementSibling) n = n.parentElement;
      if (!n) break;
      n = n.previousElementSibling;
      const m = norm(n.textContent).match(/(\S+류) 강화 능력치\s*\(([^)]*)\)\s*$/);
      if (m) title = `${m[1]} (${m[2]})`;
      else if (n.querySelector && n.querySelector('table')) break;
    }
    return { title, rows };
  }).filter(t => t.rows[0] && (t.rows[0][0] === '강화단계' || t.rows[0][0] === '목표 강화'));
}

// 강화 가능 장비: 공지상 도끼·곤봉·창·활·투구·갑옷. 공홈 아이템엔 장비 종류 필드가 없어 분류로 판단한다.
// 무기·방어구 분류는 전부 가능(물고기 무기, 머리장식·쓰개, 옷, 발톱 포함), 손톱·부메랑·스로잉 무기만 불가,
// 초보자 장비는 아래 이름표대로 (2026-11-18 사용자 확인).
const ENH_NO_WEAPON = /손톱|부메랑|스로잉/;
const ENH_BEGINNER = { '모험가 모자': 'armor', '모험가 옷': 'armor', '모험가 장갑': 'weapon' };
function enhanceKind(it) {
  if (it.cat === '무기') return ENH_NO_WEAPON.test(it.name) ? null : 'weapon';
  if (it.cat === '방어구') return 'armor';
  if (it.cat === '초보자') return ENH_BEGINNER[it.name] || null;
  return null;
}

// 목표 강화 | 기본 확률 | C급 사용 | B급 사용 | 강화비용(S) | 실패 시 페널티
function parseRates(t) {
  const head = t.rows[0].join('|');
  if (head !== '목표 강화|기본 확률|C급 사용|B급 사용|강화비용(S)|실패 시 페널티') throw new Error(`강화 확률 표 머리글 변경: ${head}`);
  const pct = s => { const m = s.match(/^(\d+)%$/); if (!m) throw new Error(`확률 해석 실패: ${s}`); return +m[1]; };
  const rates = t.rows.slice(1).map(([lv, base, c, b, cost, fail]) => {
    const r = { lv: +lv.replace('+', ''), base: pct(base), C: pct(c), B: pct(b), cost: +cost.replace(/[^\d]/g, ''), destroy: /파괴/.test(fail) };
    // 공지 규칙(C급 +10%, B급 +15%, 최대 100%)과 표가 맞는지 대조
    if (r.C !== Math.min(100, r.base + 10) || r.B !== Math.min(100, r.base + 15)) throw new Error(`+${r.lv} 보조제 확률이 규칙과 다름: ${[base, c, b]}`);
    if (!/파괴|유지/.test(fail)) throw new Error(`실패 페널티 해석 실패: ${fail}`);
    return r;
  });
  if (rates.length !== 10 || rates.some((r, i) => r.lv !== i + 1)) throw new Error('강화 확률 표가 +1~+10 이 아님');
  return rates;
}

const ENH_KEYS = { '공격': 'atk', '방어': 'def', '순발': 'agi', '내': 'hp', '내구': 'hp', '명중': 'acc', '관통': 'pen', '쉴드': 'shld', '크리': 'crit', '회피': 'evas' };

// "공격 +3, 관통 +5, 명중 +5%" → { atk:3, pen:5, acc:5 }
function parseGain(text) {
  const o = {};
  for (const part of text.split(',')) {
    const m = part.trim().match(/^(\S+)\s*([+-]\d+)%?$/);
    if (!m || !ENH_KEYS[m[1]]) throw new Error(`강화 능력치 해석 실패: "${part}" in "${text}"`);
    o[ENH_KEYS[m[1]]] = +m[2];
  }
  return o;
}

// 공지 표의 "누적" 열을 단계별 합과 대조해서 표 해석이 맞는지 확인한다.
function parseEnhance(tables) {
  const kinds = {};
  const rateTables = tables.filter(t => t.rows[0][0] === '목표 강화');
  if (rateTables.length !== 1) throw new Error(`강화 확률 표 ${rateTables.length}개 (1개여야 함)`);
  const rates = parseRates(rateTables[0]);
  for (const t of tables.filter(t => t.rows[0][0] === '강화단계')) {
    const kind = /^무기/.test(t.title) ? 'weapon' : /^방어구/.test(t.title) ? 'armor' : null;
    if (!kind) throw new Error(`강화 표 제목을 알 수 없음: "${t.title}"`);
    const steps = [], acc = {};
    for (const [lvRaw, gainRaw, cumRaw] of t.rows.slice(1)) {
      const lv = +lvRaw.replace('+', '');
      const gain = parseGain(gainRaw);
      for (const k in gain) acc[k] = (acc[k] || 0) + gain[k];
      const cum = parseGain(cumRaw);
      const same = Object.keys({ ...acc, ...cum }).every(k => acc[k] === cum[k]);
      if (!same) throw new Error(`${kind} +${lv} 누적 불일치: 합 ${JSON.stringify(acc)} vs 공지 ${cumRaw}`);
      steps.push({ lv, gain });
    }
    if (steps.length !== 10 || steps.some((s, i) => s.lv !== i + 1)) throw new Error(`${kind} 강화 단계가 +1~+10 이 아님`);
    kinds[kind] = { title: t.title, steps };
  }
  if (!kinds.weapon || !kinds.armor) throw new Error('무기/방어구 강화 표를 모두 찾지 못함');
  return { source: ENH_URL, pct: ['acc'], rates, ...kinds };
}

(async () => {
  loadEnv();
  const { OHRSA_USERNAME, OHRSA_PASSWORD } = process.env;
  if (!OHRSA_USERNAME || !OHRSA_PASSWORD) {
    console.error('OHRSA_USERNAME / OHRSA_PASSWORD 가 필요합니다 (환경변수 또는 scripts/ohrsa.local.env).');
    process.exit(1);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    await gotoRetry(page, LOGIN_URL);
    await page.fill('input[name="mb_id"]', OHRSA_USERNAME);
    await page.fill('input[name="mb_password"]', OHRSA_PASSWORD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('form[name="flogin"] button, form[name="flogin"] input[type="submit"]').catch(() => page.evaluate(() => document.forms['flogin'].submit()))
    ]);

    await gotoRetry(page, ITEM_URL);
    if (/login\.php/.test(page.url())) throw new Error('로그인 실패 - /item 접근 시 로그인 페이지로 리다이렉트됨');
    await page.waitForSelector('.item_card_item', { timeout: 30000 });

    const cards = await page.evaluate(scrapeCards);
    const items = cards.map(normalize);

    // 안전장치: 이전 결과보다 크게 줄면 페이지 구조 변경/부분 로딩으로 보고 덮어쓰지 않는다.
    const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')).items || [] : [];
    if (!items.length || items.length < prev.length * 0.8) {
      throw new Error(`스크랩 결과 ${items.length}건 (이전 ${prev.length}건) - 덮어쓰지 않음`);
    }
    const ids = new Set(items.map(i => i.id));
    if (ids.size !== items.length) throw new Error('아이템 id 중복 - 페이지 구조 확인 필요');

    fs.mkdirSync(IMG_DIR, { recursive: true });
    let got = 0, failed = 0;
    for (const it of items) {
      const ext = (path.extname(new URL(it.src || 'x:/a.png').pathname) || '.png').toLowerCase();
      const file = `${it.id}${ext}`;
      const dest = path.join(IMG_DIR, file);
      if (it.src && !fs.existsSync(dest)) {
        const res = await context.request.get(it.src).catch(() => null);
        if (res && res.ok()) { fs.writeFileSync(dest, await res.body()); got++; }
        else { failed++; console.warn(`  이미지 실패 [${it.id} ${it.name}]: ${res ? res.status() : 'network'}`); }
      }
      it.img = fs.existsSync(dest) ? `images/items/${file}` : '';
      delete it.src;
    }

    await gotoRetry(page, ENH_URL);
    const enhance = parseEnhance(await page.evaluate(scrapeEnhanceTables));
    console.log(`강화 표: 무기 ${enhance.weapon.steps.length}단계, 방어구 ${enhance.armor.steps.length}단계 (누적 열 대조 통과)`);

    const removed = prev.filter(p => !ids.has(p.id)).map(p => p.name);
    const added = items.filter(i => !prev.some(p => p.id === i.id)).map(i => i.name);
    fs.writeFileSync(OUT, JSON.stringify({ source: ITEM_URL, scrapedAt: new Date().toISOString(), enhance, items }, null, 1) + '\n', 'utf8');
    console.log(`스크랩 완료: ${items.length}건 -> ${path.relative(ROOT, OUT)} (이미지 신규 ${got}, 실패 ${failed})`);
    if (added.length) console.log(`  추가: ${added.join(', ')}`);
    if (removed.length) console.log(`  공홈에서 사라짐: ${removed.join(', ')}`);
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error('스크랩 실패:', err && err.message || err);
  process.exit(1);
});

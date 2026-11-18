#!/usr/bin/env node
/*
 * ohrsa.net 아이템 도감(/item) 스크레이퍼 (Playwright, 로그인 필요).
 *
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
  return { id: c.id, name: c.name, cat: c.cat, obtain: c.obtain, desc: c.desc, attr, s, n, pct, src: c.img };
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

    const removed = prev.filter(p => !ids.has(p.id)).map(p => p.name);
    const added = items.filter(i => !prev.some(p => p.id === i.id)).map(i => i.name);
    fs.writeFileSync(OUT, JSON.stringify({ source: ITEM_URL, scrapedAt: new Date().toISOString(), items }, null, 1) + '\n', 'utf8');
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

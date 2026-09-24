#!/usr/bin/env node
/*
 * ohrsa.net 펫 도감(petinfo) 자동 스크레이퍼 (Playwright, 로그인 필요).
 *
 * scripts/scrape-ohrsa.console.js 와 완전히 같은 DOM 파싱 로직을 헤드리스
 * 브라우저 안에서 page.evaluate()로 그대로 실행한다 (그 파일의 주석에 적힌
 * "자동화하려면 Playwright/Puppeteer로..." 방법 그대로).
 *
 * 필요 환경변수:
 *   OHRSA_USERNAME - ohrsa.net 로그인 아이디 (mb_id)
 *   OHRSA_PASSWORD - ohrsa.net 로그인 비밀번호 (mb_password)
 *
 * 출력: scripts/ohrsa_pets_auto.json (스크랩 원본, 매 실행마다 덮어씀)
 *
 * 사용법: node scripts/scrape-ohrsa.playwright.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, 'ohrsa_pets_auto.json');
const LOGIN_URL = 'https://ohrsa.net/bbs/login.php';
const PETINFO_URL = 'https://ohrsa.net/petinfo';

// ohrsa.net 이 간헐적으로 응답이 멈추므로(Cloudflare 뒤) 타임아웃을 늘리고 재시도한다.
async function gotoRetry(page, url, tries = 4) {
  for (let i = 1; ; i++) {
    try { return await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); }
    catch (e) { if (i >= tries) throw e; console.warn(`goto 재시도 ${i}/${tries - 1}: ${url}`); }
  }
}

// scripts/scrape-ohrsa.console.js 의 IIFE 본문과 동일한 로직 (return 값만 다름).
function scrapePage() {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const cnt = el => (el.textContent.match(/획득\s*[:：]/g) || []).length;
  const HAS = el => /획득\s*[:：]/.test(el.textContent) && /판매\s*[:：]/.test(el.textContent);

  const cards = [...document.querySelectorAll('*')]
    .filter(el => HAS(el) && ![...el.children].some(HAS))
    .map(el => { let n = el; while (n.parentElement && cnt(n.parentElement) === 1) n = n.parentElement; return n; });

  const num = s => { const m = norm(s).match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; };

  return cards.map((el, i) => {
    const txt = norm(el.textContent);
    const attrs = [...txt.matchAll(/([지수화풍])\s*\(\s*(\d+)\s*\)/g)].map(m => [m[1], +m[2]]);
    const obtain = (txt.match(/획득\s*[:：]\s*(.*?)\s*(?=판매\s*[:：]|$)/) || [])[1] || '';
    const sell = (txt.match(/판매\s*[:：]\s*(\S+)/) || [])[1] || '';
    const name = norm(txt.split(/[지수화풍]\s*\(|획득\s*[:：]/)[0]);

    const F = {};
    const rows = [...el.querySelectorAll('tr')].map(tr =>
      [...tr.children].map(c => norm(c.textContent)));
    for (let r = 0; r + 1 < rows.length; r += 2)
      rows[r].forEach((h, c) => { if (h) F[h] = rows[r + 1][c]; });

    const init = norm(F['초기치'] || '').match(/\d+/g)?.map(Number) || [];
    return {
      i, name, attrs, obtain, sell,
      기술창: num(F['기술창']),
      탑승: F['탑승'] || '',
      성장률표기: num(F['성장률']),
      초기치_공방순내: init,
      init_내공방순: init.length === 4 ? [init[3], init[0], init[1], init[2]] : null,
      growth_내공방순: ['내구력', '공격력', '방어력', '순발력'].map(k => num(F[k])),
      img: el.querySelector('img')?.src || null,
      raw: txt
    };
  });
}

async function autoScroll(page) {
  // 무한스크롤/지연로딩 대비: 더 이상 페이지 높이가 늘지 않을 때까지 스크롤.
  let prevHeight = 0;
  for (let i = 0; i < 40; i++) {
    const height = await page.evaluate(() => document.body.scrollHeight);
    if (height === prevHeight) break;
    prevHeight = height;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
  }
}

(async () => {
  const { OHRSA_USERNAME, OHRSA_PASSWORD } = process.env;
  if (!OHRSA_USERNAME || !OHRSA_PASSWORD) {
    console.error('OHRSA_USERNAME / OHRSA_PASSWORD 환경변수가 필요합니다.');
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

    await gotoRetry(page, PETINFO_URL);
    if (/login\.php/.test(page.url())) {
      throw new Error('로그인 실패 - petinfo 접근 시 로그인 페이지로 리다이렉트됨 (계정 정보 확인 필요)');
    }
    await page.waitForLoadState('load').catch(() => {});
    await page.waitForTimeout(3000);
    console.log('petinfo 진입 URL:', page.url());
    await autoScroll(page);

    const diag = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      bodyLen: document.body ? document.body.innerHTML.length : 0,
      iframeCount: document.querySelectorAll('iframe').length,
      obtainMatches: (document.body.textContent.match(/획득\s*[:：]/g) || []).length,
      sellMatches: (document.body.textContent.match(/판매\s*[:：]/g) || []).length,
      tableCount: document.querySelectorAll('table').length,
      // 세션/쿠키 등이 섞일 수 있는 마크업 원문 대신, 본문 "텍스트"만 짧게 남긴다
      // (CI 로그에만 남고 파일/아티팩트로는 저장하지 않음).
      bodyTextPreview: (document.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1500)
    }));
    console.log('진단 정보:', JSON.stringify(diag, null, 2));

    const out = await page.evaluate(scrapePage);
    if (!Array.isArray(out) || out.length === 0) {
      // iframe 안에 실제 콘텐츠가 있을 수 있으니 각 프레임에서도 시도해본다.
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
          const frameOut = await frame.evaluate(scrapePage);
          if (Array.isArray(frameOut) && frameOut.length > 0) {
            fs.writeFileSync(OUT, JSON.stringify(frameOut, null, 2), 'utf8');
            console.log(`(iframe에서 발견) 스크랩 완료: ${frameOut.length}건 -> ${OUT}`);
            return;
          }
        } catch (_) { /* cross-origin 등으로 실패할 수 있음, 무시 */ }
      }
      throw new Error('스크랩 결과가 비어있음 - 페이지 구조가 바뀌었을 수 있음 (위 진단 정보 참고)');
    }

    fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
    console.log(`스크랩 완료: ${out.length}건 -> ${OUT}`);
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error('스크랩 실패:', err && err.message || err);
  process.exit(1);
});

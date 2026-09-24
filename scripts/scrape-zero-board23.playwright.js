#!/usr/bin/env node
/*
 * sathezero.com 페트 도감 스크레이퍼 (Playwright, 로그인 필요).
 *
 * 사이트가 개편되어 board23 은 https://sathezero.com/pet_info.php 로 리다이렉트된다
 * (.pc-card 카드 170개가 한 페이지에 전부 들어있고 hidden 처리만 되어 있음).
 * 예전 scrape-zero-board23.console.js(.pet_card 마크업)는 더 이상 동작하지 않는다.
 * 출력은 build-zero-pet-data.js 가 읽는 기존 스키마에 맞춘다
 * (탑승여부/판매등급은 새 사이트에 없어 ride:'' grade:'').
 *
 * 로그인 정보: scripts/sathezero.local.env (gitignore) 또는 환경변수
 *   SATHEZERO_USERNAME / SATHEZERO_PASSWORD
 *
 * 출력: scripts/zero_board23_pets.json (덮어씀)
 * 사용법: node scripts/scrape-zero-board23.playwright.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, 'zero_board23_pets.json');
const ENV = path.join(__dirname, 'sathezero.local.env');
const LOGIN_URL = 'https://sathezero.com/bbs/login.php';
const PET_URL = 'https://sathezero.com/pet_info.php';

if (fs.existsSync(ENV)) {
  for (const l of fs.readFileSync(ENV, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !l.trim().startsWith('#') && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// 페이지 안에서 실행: .pc-card -> 기존 zero_board23_pets.json 스키마
function parseCards() {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  return [...document.querySelectorAll('article.pc-card')].map(card => {
    const id = card.dataset.id;
    const elements = [...card.querySelectorAll('header .pc-element')].map(el => {
      const label = norm(el.querySelector('.pc-element-label')?.textContent || '');
      const m = label.match(/^([가-힣])\s*(\d+)/);
      return { raw: label, attr: m ? m[1] : null, level: m ? +m[2] : null };
    });
    const paths = [...card.querySelectorAll('.pc-route p')].map(p => norm(p.textContent));
    const init = {}, growth = {};
    card.querySelectorAll('table.pc-stats tbody tr').forEach(tr => {
      const k = norm(tr.querySelector('th')?.textContent);
      const td = tr.querySelectorAll('td');
      init[k] = norm(td[0]?.textContent);
      growth[k] = norm(td[1]?.textContent);
    });
    const src = card.querySelector('.pc-art img')?.getAttribute('src');
    return {
      no: String(id).padStart(3, '0'),
      name: card.dataset.name,
      img: src ? new URL(src, location.href).href : null,
      route: paths[0] ? paths[0] + (paths.length > 1 ? ` 외 ${paths.length - 1}개 경로` : '') : '',
      routes: paths,
      categories: card.dataset.categories,
      elements, init, growth,
      ride: '', totalGrowth: card.dataset.total || '', grade: ''
    };
  });
}

async function gotoRetry(page, url, tries = 4) {
  for (let i = 1; ; i++) {
    try { return await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); }
    catch (e) { if (i >= tries) throw e; console.warn(`goto 재시도 ${i}/${tries - 1}: ${url}`); }
  }
}

(async () => {
  const { SATHEZERO_USERNAME, SATHEZERO_PASSWORD } = process.env;
  if (!SATHEZERO_USERNAME || !SATHEZERO_PASSWORD) {
    console.error('SATHEZERO_USERNAME / SATHEZERO_PASSWORD 가 필요합니다 (scripts/sathezero.local.env).');
    process.exit(1);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  try {
    await gotoRetry(page, LOGIN_URL);
    await page.fill('input[name="mb_id"]', SATHEZERO_USERNAME);
    await page.fill('input[name="mb_password"]', SATHEZERO_PASSWORD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('form[name="flogin"] button, form[name="flogin"] input[type="submit"]').catch(() => page.evaluate(() => document.forms['flogin'].submit()))
    ]);

    await gotoRetry(page, PET_URL);
    if (/login\.php/.test(page.url())) throw new Error('로그인 실패 - 계정 정보 확인 필요');
    await page.waitForLoadState('load').catch(() => {});
    const all = await page.evaluate(parseCards);
    if (!Array.isArray(all) || all.length === 0) throw new Error('수집 0건 - 권한/마크업 확인 필요');
    fs.writeFileSync(OUT, JSON.stringify(all, null, 2), 'utf8');
    console.log(`스크랩 완료: ${all.length}건 -> ${OUT}`);
  } catch (e) {
    console.error('스크랩 실패:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();

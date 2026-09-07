/*
 * ohrsa.net 펫 도감 스크레이퍼 (브라우저 콘솔 전용)
 * ------------------------------------------------------------------
 * 사용법:
 *   1. ohrsa.net 펫 목록 페이지를 연다 (전체 펫이 한 페이지에 렌더된 상태여야 함).
 *   2. DevTools > Console 에 이 파일 내용을 붙여넣고 실행.
 *   3. ohrsa_pets.json 이 자동 다운로드된다. 프로젝트 루트의 ohrsa_pets.json 을 교체.
 *
 * 주의:
 *   - DOM 파싱 방식이라 Node/GitHub Actions 에서 그대로 못 돌린다.
 *     자동화하려면 Playwright/Puppeteer 로 페이지를 띄운 뒤 page.evaluate() 로 이 함수를 실행.
 *   - 출력 구조(i, name, attrs, obtain, sell, 기술창, 탑승, 성장률표기,
 *     초기치_공방순내, init_내공방순, growth_내공방순, img, raw)는
 *     index.html 의 <script id="pet-data"> 구조(id, attr, origin, k, ok, approx,
 *     initS, growthS, base64 img)와 다르다. 계산기에 반영하려면 별도 변환 단계 필요.
 */
(() => {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const cnt  = el => (el.textContent.match(/획득\s*[:：]/g) || []).length;
  const HAS  = el => /획득\s*[:：]/.test(el.textContent) && /판매\s*[:：]/.test(el.textContent);

  const cards = [...document.querySelectorAll('*')]
    .filter(el => HAS(el) && ![...el.children].some(HAS))
    .map(el => { let n = el; while (n.parentElement && cnt(n.parentElement) === 1) n = n.parentElement; return n; });

  const num = s => { const m = norm(s).match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; };

  const out = cards.map((el, i) => {
    const txt   = norm(el.textContent);            // ← innerText 아님
    const attrs = [...txt.matchAll(/([지수화풍])\s*\(\s*(\d+)\s*\)/g)].map(m => [m[1], +m[2]]);
    const obtain = (txt.match(/획득\s*[:：]\s*(.*?)\s*(?=판매\s*[:：]|$)/) || [])[1] || '';
    const sell   = (txt.match(/판매\s*[:：]\s*(\S+)/) || [])[1] || '';
    const name   = norm(txt.split(/[지수화풍]\s*\(|획득\s*[:：]/)[0]);

    // 표: 헤더행 / 값행 이 번갈아 나옴 → 라벨-값 매핑
    const F = {};
    const rows = [...el.querySelectorAll('tr')].map(tr =>
      [...tr.children].map(c => norm(c.textContent)));
    for (let r = 0; r + 1 < rows.length; r += 2)
      rows[r].forEach((h, c) => { if (h) F[h] = rows[r + 1][c]; });

    const init = norm(F['초기치'] || '').match(/\d+/g)?.map(Number) || [];
    return {
      i, name, attrs, obtain, sell,
      기술창: num(F['기술창']),
      탑승:   F['탑승'] || '',
      성장률표기: num(F['성장률']),
      초기치_공방순내: init,                                   // 6 6 5 36
      init_내공방순: init.length === 4 ? [init[3], init[0], init[1], init[2]] : null,
      growth_내공방순: ['내구력','공격력','방어력','순발력'].map(k => num(F[k])),
      img: el.querySelector('img')?.src || null,
      raw: txt
    };
  });

  console.log('카드 수:', out.length);
  console.table(out.slice(0, 10).map(o => ({
    이름:o.name, 초기치:(o.init_내공방순||[]).join('/'),
    성장률:(o.growth_내공방순||[]).join('/'), 기술창:o.기술창, 탑승:o.탑승
  })));

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], {type:'application/json'}));
  a.download = 'ohrsa_pets.json'; a.click();
})();

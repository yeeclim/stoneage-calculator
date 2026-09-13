/*
 * sathezero.com (스톤에이지 제로) board23 "페트정보" 도감 스크레이퍼 (브라우저 콘솔 전용)
 * ------------------------------------------------------------------
 * 실제 마크업 구조(zero_board23_debug.html 로 확인):
 *   - 일반 게시판 글 목록이 아니라 #bo_pet .pet_grid > .pet_card 카드 그리드.
 *   - 카드 안에 이름/번호/이미지/획득경로/속성(Lv)/초기치/성장률/탑승여부/판매등급이
 *     전부 목록 페이지 자체에 렌더되어 있어 상세글(wr_id)을 따로 열 필요가 없음.
 *   - 페이지네이션은 ?bo_table=board23&page=N (gnuboard5 표준 방식).
 *
 * 사용법:
 *   1. https://sathezero.com/bbs/board.php?bo_table=board23 에 로그인 상태로 접속.
 *   2. DevTools > Console 에 이 파일 내용을 붙여넣고 실행
 *      (처음엔 "allow pasting" 입력 후 Enter → 그다음 스크립트 붙여넣기).
 *   3. 로그인 세션 쿠키로 나머지 페이지를 자동 fetch 해서 전부 모은 뒤
 *      zero_board23_pets.json 이 자동 다운로드된다. 그 파일을 첨부.
 */
(() => {
  const params   = new URLSearchParams(location.search);
  const BO_TABLE = params.get('bo_table') || 'board23';
  const BASE = location.origin + location.pathname; // .../bbs/board.php
  const CURRENT_PAGE = +(params.get('page') || '1');

  const norm  = s => (s || '').replace(/\s+/g, ' ').trim();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const pageUrl = n => `${BASE}?bo_table=${encodeURIComponent(BO_TABLE)}&page=${n}`;

  function detectTotalPages(doc) {
    const nums = [...doc.querySelectorAll('.pg_wrap a.pg_page')]
      .map(a => +(new URL(a.getAttribute('href'), location.href)).searchParams.get('page'))
      .filter(n => !Number.isNaN(n));
    const cur = +(doc.querySelector('.pg_wrap .pg_current')?.textContent || '1');
    return Math.max(cur, ...nums, 1);
  }

  function parseCard(card) {
    const noText = norm(card.querySelector('.pet_no')?.textContent || '');
    const no = (noText.match(/\d+/) || [])[0] || null;
    const nameFull = norm(card.querySelector('.pet_name')?.textContent || '');
    const name = norm(nameFull.replace(noText, ''));
    const imgSrc = card.querySelector('.pet_img img')?.getAttribute('src') || null;
    const img = imgSrc ? new URL(imgSrc, location.href).href : null;
    const route = norm(card.querySelector('.pet_route')?.textContent || '');

    const elements = [...card.querySelectorAll('.pet_el')].map(elDiv => {
      const lbText = norm(elDiv.querySelector('.lb')?.textContent || '');
      const m = lbText.match(/^([가-힣])\s*\(\s*Lv\.?\s*(\d+)\s*\)/);
      return { raw: lbText, attr: m ? m[1] : null, level: m ? +m[2] : null };
    });

    const statTables = card.querySelectorAll('table.pet_stat');
    const statMap = {};
    if (statTables[0]) {
      [...statTables[0].querySelectorAll('tr')].forEach(tr => {
        const label = norm(tr.querySelector('th')?.textContent || '');
        const kv = {};
        [...tr.querySelectorAll('td')].forEach(td => {
          const k = norm(td.querySelector('.k')?.textContent || '');
          const v = norm(td.querySelector('.v')?.textContent || '');
          if (k) kv[k] = v;
        });
        if (label) statMap[label] = kv;
      });
    }

    let ride = null, totalGrowth = null, grade = null;
    if (statTables[1]) {
      const rows = [...statTables[1].querySelectorAll('tr')];
      const tds0 = [...(rows[0]?.querySelectorAll('td') || [])];
      ride = norm(tds0[0]?.textContent || '');
      totalGrowth = norm(tds0[1]?.textContent || '');
      const tds1 = [...(rows[1]?.querySelectorAll('td') || [])];
      grade = norm(tds1[0]?.textContent || '');
    }

    return {
      no, name, img, route, elements,
      init: statMap['초기치'] || {},
      growth: statMap['성장률'] || {},
      ride, totalGrowth, grade,
      raw: norm(card.textContent)
    };
  }

  function parseListDoc(doc) {
    return [...doc.querySelectorAll('#bo_pet .pet_card')].map(parseCard);
  }

  async function fetchPage(n) {
    const res  = await fetch(pageUrl(n), { credentials: 'same-origin' });
    const html = await res.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  (async () => {
    const totalPages = detectTotalPages(document);
    console.log('감지된 총 페이지 수:', totalPages);

    const all = [];
    for (let p = 1; p <= totalPages; p++) {
      let doc;
      if (p === CURRENT_PAGE) {
        doc = document;
      } else {
        doc = await fetchPage(p);
        await sleep(300);
      }
      const rows = parseListDoc(doc);
      rows.forEach(r => all.push({ page: p, ...r }));
      console.log(`page ${p}: ${rows.length}건`);
    }

    console.log('총 수집:', all.length);
    console.table(all.slice(0, 10).map(o => ({
      no: o.no, name: o.name, 등급: o.grade, 총성장률: o.totalGrowth
    })));

    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' }));
    a.download = 'zero_board23_pets.json';
    a.click();
  })();
})();

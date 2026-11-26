#!/usr/bin/env node
/*
 * 네온(neonine.cc) 아이템 도감 스크랩 -> neon-items.json (계산기 '네온 아이템' 탭이 처음 열 때 불러옴)
 *
 * 목록(/items?page=N)에서 번호·이름·분류·능력치 한 줄·설명·이미지를 모으고, 상세(/items/<번호>)에서
 * 가격·필요 레벨·변형별 능력치(속성·마법 변형)·제작 재료·표시(합성 재료 등)를 읽는다.
 * 받은 HTML 은 data/neon-cache/ 에 캐시(.gitignore 대상) - 파서만 고칠 때는 --offline.
 * 이미지는 images/neon-items/<게임 이미지 번호>.png 로 내려받는다(있으면 건너뜀). 요청 간격 1초.
 *
 * 사용법:
 *   node scripts/scrape-neon-items.js            # 캐시 없는 페이지만 받고 파싱 + 이미지
 *   node scripts/scrape-neon-items.js --refresh  # 캐시 무시하고 전부 다시 받기
 *   node scripts/scrape-neon-items.js --offline  # 네트워크 없이 캐시만 파싱 (이미지도 안 받음)
 */
const fs = require('fs');
const path = require('path');

const BASE = 'https://neonine.cc';
const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, 'data', 'neon-cache');
const OUT = path.join(ROOT, 'neon-items.json');
const IMG_DIR = path.join(ROOT, 'images', 'neon-items');
const DELAY_MS = 1000;
const REFRESH = process.argv.includes('--refresh');
const OFFLINE = process.argv.includes('--offline');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastReq = 0;
async function polite() {
  const wait = lastReq + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastReq = Date.now();
}

async function getPage(urlPath, cacheName) {
  const file = path.join(CACHE, cacheName);
  if (!REFRESH && fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  if (OFFLINE) return null;
  await polite();
  const r = await fetch(BASE + urlPath, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${urlPath}`);
  const html = await r.text();
  fs.writeFileSync(file, html, 'utf8');
  return html;
}

// ---- 파싱 ---------------------------------------------------------------

const decode = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function tokens(html) {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!-- -->/g, '');
  return body.split(/<[^>]*>/).map(t => decode(t).trim()).filter(Boolean);
}

// 능력치 한 줄: 고정값 "공+2 방+2 순-2 매력+1", 합성품의 범위 "공[43~65] 방[-22~-14] 매력[0~2]",
// 띄어쓴 이름 "모든 내성+4", 맨손 타격 횟수 "공[22~32] (x3)"
// -> { 공: [2, 2], ... } / { 공: [43, 65], ... }  (항상 [최소, 최대])
const STAT_NAME = '[가-힣A-Za-z]+(?: [가-힣A-Za-z]+)*';
const STAT_VALUE = '(?:\\s?([+-]\\d+(?:\\.\\d+)?)%?|\\[(-?\\d+)~(-?\\d+)\\])';
const HITS = '\\(x\\d+(?:-\\d+)?\\)';      // 타격 횟수 (x3), 활은 범위 (x2-5)
const STATLINE = new RegExp(`^(?:(?:${STAT_NAME}${STAT_VALUE.replace(/\((?!\?)/g, '(?:')}|${HITS})\\s*)+$`);
function parseStatline(s) {
  const out = {};
  for (const m of String(s).matchAll(new RegExp(`(${STAT_NAME})${STAT_VALUE}`, 'g'))) {
    out[m[1]] = m[2] !== undefined ? [Number(m[2]), Number(m[2])] : ordered(Number(m[3]), Number(m[4]));
  }
  return out;
}
// 사이트가 음수 범위를 '순[-4~-8]' 처럼 거꾸로 적기도 한다 -> [작은 값, 큰 값]
function ordered(a, b) { return a <= b ? [a, b] : [b, a]; }
const hitsOf = s => { const m = /\(x(\d+(?:-\d+)?)\)/.exec(s || ''); return m ? m[1] : null; };   // "3" 또는 "2-5"
// 표 칸: "9" -> [9, 9], "43~65" -> [43, 65], "-"·빈 칸 -> null
function parseCell(s) {
  const m = String(s).trim().match(/^([+-]?\d+(?:\.\d+)?)(?:~([+-]?\d+(?:\.\d+)?))?$/);
  if (!m) return null;
  return ordered(Number(m[1]), Number(m[2] ?? m[1]));
}
const ATTR_TAG = /^\[[^\]]+\]$/;          // 이름 뒤 속성 표시: [지], [무/지/수/화/풍]
const BADGES = ['합성 재료', '합성 결과'];  // 상세의 표시 (그 밖의 글은 설명으로)

// 목록 페이지 -> [{ no, name, attrTag, cat, lv, statline, desc, img }]
function parseList(html) {
  const out = [];
  const parts = html.split(/(?=<a [^>]*href="\/items\/\d+")/);
  for (const part of parts) {
    const m = part.match(/^<a [^>]*href="\/items\/(\d+)"/);
    if (!m) continue;
    const a = part.slice(0, part.indexOf('</a>') + 4);
    const img = (a.match(/src="(\/game\/items\/[^"]+)"/) || [])[1] || '';
    const tk = tokens(a);
    // [이름, 속성 표시?, 분류( · Lv.N), 능력치 한 줄?, 설명?]
    const name = tk.shift();
    if (!name) continue;
    const attrTag = ATTR_TAG.test(tk[0] || '') ? tk.shift() : '';
    const [cat, lvText] = String(tk.shift() || '').split('·').map(s => s.trim());
    const statline = tk.find(t => STATLINE.test(t)) || '';
    const desc = tk.filter(t => t !== statline).join(' ');
    // 분류 뒤는 보통 'Lv.N' 이지만 합성 목걸이처럼 '25종'(변형 수)이 오기도 한다
    const lv = /^Lv\./.test(lvText || '') ? lvText : '';
    out.push({ no: m[1], name, attrTag, cat: cat || '', lv, statline, desc, img });
  }
  return out;
}

// 상세 페이지 -> { name, attrTag, cat, price, lv, variantCount, badges, statline, desc, table, materials, materialNote }
function parseDetail(html) {
  const tk = tokens(html);
  const start = tk.indexOf('아이템 도감');
  const end = tk.indexOf('도감으로', start);
  const main = tk.slice(start + 1, end > 0 ? end : undefined);
  const tableAt = main.findIndex(t => t === '능력치' || t === '변형별 능력치');
  const matAt = main.indexOf('제작 재료');
  const headEnd = Math.min(...[tableAt, matAt, main.length].filter(i => i >= 0));
  // 머리: [분류(경로), 이름, 속성 표시?, 분류, ...표시들]
  const head = main.slice(0, headEnd);
  let k = 1;
  const name = head[k++];
  const attrTag = ATTR_TAG.test(head[k] || '') ? head[k++] : '';
  const d = { name, attrTag, cat: head[k++] || head[0] || '', price: null, lv: '', variantCount: 1,
    badges: [], statline: '', desc: [], table: null, materials: [], materialNote: '' };
  for (const t of head.slice(k)) {
    let m;
    if ((m = t.match(/^([\d,]+)\s*스톤$/))) d.price = Number(m[1].replace(/,/g, ''));
    else if (/^Lv\.\d+(?:~\d+)?$/.test(t)) d.lv = t;
    else if ((m = t.match(/^변형 (\d+)종$/))) d.variantCount = Number(m[1]);
    else if (!d.statline && STATLINE.test(t)) d.statline = t;
    else if (BADGES.includes(t)) d.badges.push(t);
    else d.desc.push(t);
  }
  d.desc = d.desc.join(' ');
  // 능력치 표: 머리글(…번호)까지, 그 뒤로 머리글 칸 수만큼씩 행
  let i = headEnd;
  if (tableAt >= 0) {
    const hEnd = main.indexOf('번호', tableAt);
    const cols = main.slice(tableAt + 1, hEnd + 1);
    const rows = [];
    i = hEnd + 1;
    while (i + cols.length <= main.length) {
      const row = main.slice(i, i + cols.length);
      if (!/^\d+$/.test(row[row.length - 1])) break;
      rows.push(row);
      i += cols.length;
    }
    d.table = { cols, rows };
  }
  // 제작 재료: "제작 재료" (+ 설명) 뒤로 [재료명, "N단계"] 쌍 - 표가 없는 아이템에도 있다
  const mAt = main.indexOf('제작 재료', i);
  if (mAt >= 0) {
    let j = mAt + 1;
    if (main[j] && !/^\d+단계$/.test(main[j + 1] || '')) { d.materialNote = main[j]; j++; }
    for (; j + 1 < main.length; j += 2) {
      const lvm = main[j + 1].match(/^(\d+)단계$/);
      if (!lvm) break;
      d.materials.push({ name: main[j], lv: Number(lvm[1]) });
    }
  }
  return d;
}

// 표 열 이름 -> 능력치 한 줄과 같은 짧은 이름 (정렬·비교용)
const SHORT = { 공격: '공', 방어: '방', 순발: '순', 크리티컬: '크리', 체력: '내' };

// 표 한 행 -> { attr?, magic?, stats{공: [최소, 최대]..}, no }. 빈 칸("-")은 뺀다
function tableVariants(table) {
  if (!table) return [];
  const cols = table.cols;
  return table.rows.map(r => {
    const v = { no: r[r.length - 1], stats: {} };
    cols.forEach((c, k) => {
      const cell = r[k];
      if (c === '번호') return;
      if (c === '속성') { v.attr = cell; return; }
      if (c === '마법') { if (cell && cell !== '-') v.magic = cell; return; }
      const range = parseCell(cell);
      if (range) v.stats[SHORT[c] || c] = range;
    });
    return v;
  });
}

const extOf = b => b.slice(0, 4).toString() === 'GIF8' ? 'gif'
  : b[0] === 0x89 ? 'png' : b[0] === 0xff ? 'jpg' : b.slice(0, 4).toString() === 'RIFF' ? 'webp' : null;

async function localizeImage(src) {
  if (!src) return '';
  const base = path.basename(src).replace(/\.[a-z]+$/i, '');
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const have = fs.readdirSync(IMG_DIR).find(f => path.parse(f).name === base);
  if (have) return `images/neon-items/${have}`;
  if (OFFLINE) return BASE + src;
  await polite();
  const r = await fetch(BASE + src, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${src}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const ext = extOf(buf);
  if (!ext) throw new Error(`이미지 아님 ${src}`);
  fs.writeFileSync(path.join(IMG_DIR, `${base}.${ext}`), buf);
  return `images/neon-items/${base}.${ext}`;
}

module.exports = { parseList, parseDetail, parseStatline, tableVariants };

if (require.main === module) (async () => {
  fs.mkdirSync(CACHE, { recursive: true });

  // 1) 목록 - 새 번호가 안 나올 때까지 (마지막 페이지를 넘기면 마지막 페이지가 반복된다)
  const list = [];
  const seen = new Set();
  for (let page = 1; page <= 30; page++) {
    const html = await getPage(page === 1 ? '/items' : `/items?page=${page}`, `items-list-${page}.html`);
    if (!html) break;
    const items = parseList(html).filter(x => !seen.has(x.no));
    if (!items.length) break;
    for (const x of items) { seen.add(x.no); list.push(x); }
  }
  console.log(`목록: ${list.length}개`);

  // 2) 상세 + 이미지
  const out = [];
  const failed = [];
  for (const [i, it] of list.entries()) {
    try {
      const html = await getPage(`/items/${it.no}`, `item-${it.no}.html`);
      if (!html) { failed.push(it.no); continue; }
      const d = parseDetail(html);
      const variants = tableVariants(d.table);
      const img = await localizeImage(it.img).catch(e => { console.warn(`이미지 실패 ${it.no}: ${e.message}`); return ''; });
      out.push({
        id: it.no,
        name: it.name,
        attrTag: it.attrTag || d.attrTag || '',
        cat: it.cat || d.cat,
        lv: d.lv || it.lv || '',
        stats: parseStatline(d.statline || it.statline),
        statline: d.statline || it.statline,
        hits: hitsOf(d.statline || it.statline),
        desc: d.desc || it.desc,
        price: d.price,
        badges: d.badges,
        variantCount: d.variantCount,
        variants,
        materials: d.materials,
        materialNote: d.materialNote,
        img,
      });
      if (d.name && d.name !== it.name) console.warn(`이름 다름 ${it.no}: 목록 ${it.name} / 상세 ${d.name}`);
      if (d.cat && it.cat && d.cat !== it.cat) console.warn(`분류 다름 ${it.no} ${it.name}: 목록 ${it.cat} / 상세 ${d.cat}`);
      // 사이트가 변형별 표를 안 보여 주는 아이템도 있다 (조교의 팔찌, 합성 목걸이 등) - variantCount 로 '변형 N종'만 표시
      if (variants.length && d.variantCount !== variants.length) console.warn(`변형 수 다름 ${it.no} ${it.name}: 표시 ${d.variantCount}, 표 ${variants.length}`);
    } catch (e) {
      failed.push(it.no);
      console.warn(`실패 ${it.no}: ${e.message}`);
    }
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${list.length}`);
  }

  const doc = {
    source: `${BASE}/items`,
    scrapedAt: new Date().toISOString(),
    note: '속성·마법 변형은 한 줄로 묶고 초보용 장비·얻을 수 없는 것은 제외 (네온 도감 기준)',
    items: out,
  };
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 1), 'utf8');
  console.log(`저장: ${out.length}개 -> ${path.relative(ROOT, OUT)}${failed.length ? ` (실패 ${failed.length}: ${failed.join(',')})` : ''}`);
})();

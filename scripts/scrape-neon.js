#!/usr/bin/env node
/*
 * 네온(neonine.cc) 페트 도감 스크랩 -> scripts/neon_pets.json
 *
 * 목록(/pets?page=N)에서 펫 번호를 모으고, 상세(/pets/<번호>)에서 초기치·성장률·환생 후
 * 능력치·탑승·속성 등을 읽는다. 받은 HTML 은 data/neon-cache/ 에 캐시해서(.gitignore 대상)
 * 파서만 고쳐 다시 돌릴 때는 네트워크 요청을 하지 않는다. 요청 간격은 1초.
 *
 * 사용법:
 *   node scripts/scrape-neon.js            # 캐시 없는 페이지만 받고 파싱
 *   node scripts/scrape-neon.js --refresh  # 캐시 무시하고 전부 다시 받기
 *   node scripts/scrape-neon.js --offline  # 네트워크 없이 캐시만 파싱
 */
const fs = require('fs');
const path = require('path');

const BASE = 'https://neonine.cc';
const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, 'data', 'neon-cache');
const OUT = path.join(__dirname, 'neon_pets.json');
const DELAY_MS = 1000;
const CATEGORIES = ['필드', '퀘스트', '스페셜', '구입', '코스/환생'];
const REFRESH = process.argv.includes('--refresh');
const OFFLINE = process.argv.includes('--offline');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastReq = 0;

async function getPage(urlPath, cacheName) {
  const file = path.join(CACHE, cacheName);
  if (!REFRESH && fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  if (OFFLINE) return null;
  const wait = lastReq + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastReq = Date.now();
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

// HTML -> 보이는 텍스트 토큰 배열 (태그 경계로 자름, 공백만인 토큰 제거)
function tokens(html) {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!-- -->/g, '');
  return body.split(/<[^>]*>/).map(t => decode(t).trim()).filter(Boolean);
}

const num = s => {
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

// "초기" 또는 "성장" 토큰 뒤의 숫자 4개(+ 총성) 읽기. 값이 "-" 면 null.
function readRow(tk, from, label) {
  const i = tk.indexOf(label, from);
  if (i < 0) return null;
  const vals = tk.slice(i + 1, i + 6).map(t => (t === '-' ? null : num(t)));
  return { at: i, stats: vals.slice(0, 4), total: vals[4] };
}

// 능력치 표 하나: "체력 공격 방어 순발 총성" 머리글 뒤 초기/성장 행
function readStatTable(tk, from) {
  const h = tk.indexOf('체력', from);
  if (h < 0 || tk[h + 1] !== '공격' || tk[h + 2] !== '방어' || tk[h + 3] !== '순발') return null;
  const init = readRow(tk, h, '초기');
  const growth = readRow(tk, h, '성장');
  if (!init || !growth) return null;
  return { at: h, init: init.stats, growth: growth.stats, totalGrowth: growth.total };
}

function parseAttrs(s) {
  // "지8 수2" -> [["지",8],["수",2]]
  const out = [];
  for (const m of String(s).matchAll(/([지수화풍])\s*(\d+)/g)) out.push([m[1], +m[2]]);
  return out;
}

function parseDetail(id, html) {
  const tk = tokens(html);
  const titleM = html.match(/<title>([^<]*?) - 페트 도감/);
  const name = titleM ? decode(titleM[1]).trim() : null;
  if (!name) return null;

  // 머리 영역: 이름 다음에 계열, 획득방법 분류, (탑승 가능), 스킬 슬롯, 판매 등급, 획득, 속성
  const nameAt = tk.indexOf(name, tk.indexOf('페트 도감'));
  const head = tk.slice(nameAt, tk.indexOf('능력치', nameAt));
  const family = head.find(t => /계열$/.test(t)) || '';
  // 획득 분류는 없는 펫도 있다(그때 계열 다음 토큰은 "탑승 가능"/"스킬 슬롯 N").
  const category = head.find(t => CATEGORIES.includes(t)) || '';
  const ride = head.includes('탑승 가능');
  // "스킬 슬롯 6" 처럼 라벨과 값이 한 토큰으로 붙어 오기도, 따로 오기도 한다.
  const labeled = label => {
    const at = head.findIndex(t => t.startsWith(label));
    if (at < 0) return '';
    const rest = head[at].slice(label.length).trim();
    return rest || head[at + 1] || '';
  };
  const slots = num(labeled('스킬 슬롯'));
  const grade = labeled('판매 등급');
  const obtainAt = head.findIndex(t => /^획득:?$/.test(t));
  const obtain = obtainAt >= 0 ? head[obtainAt + 1] : '';
  const attrAt = head.indexOf('속성');
  const attrs = attrAt >= 0 ? parseAttrs(head[attrAt + 1]) : [];

  // 기본 능력치 표만 읽는다. "환생 후 능력치" 칸은 현재 전 개체가 "환생할 수 없는 페트입니다."이고,
  // 환생 개체(환생얼룩우리 등)는 별도 펫으로 올라와 있다. 환생 후 표가 생기면 rebirthTable 로 남긴다.
  const rebirthAt = tk.indexOf('환생 후 능력치');
  const base = readStatTable(tk, tk.indexOf('능력치'));
  const rebirthTable = rebirthAt >= 0 ? readStatTable(tk, rebirthAt) : null;
  const rideAtTk = tk.findIndex(t => /^탈 수 있는 캐릭터/.test(t));
  const rebirth = rebirthTable && (rideAtTk < 0 || rebirthTable.at < rideAtTk)
    ? { init: rebirthTable.init, growth: rebirthTable.growth, totalGrowth: rebirthTable.totalGrowth } : null;

  const riders = [];
  const rideAt = tk.findIndex(t => /^탈 수 있는 캐릭터/.test(t));
  if (rideAt >= 0) {
    const sameAt = tk.indexOf('같은 계열', rideAt);
    const infoAt = tk.indexOf('탑승 정보', rideAt);
    if (infoAt >= 0) for (const t of tk.slice(infoAt + 1, sameAt >= 0 ? sameAt : infoAt + 20)) riders.push(t);
  }

  // 대표 이미지: alt 가 이름과 같은 첫 /game/pets/ 이미지 (128px)
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const imgM = html.match(new RegExp(`<img src="(/game/pets/[^"]+)" alt="${esc}"`));
  const img = imgM ? BASE + imgM[1] : '';

  return {
    no: id, name, family, category, ride, riders, slots, grade, obtain, attrs,
    init: base ? base.init : null,
    growth: base ? base.growth : null,
    totalGrowth: base ? base.totalGrowth : null,
    rebirth,
    img,
  };
}

// 목록 페이지 -> [{no, name, hoverGif}]
function parseList(html) {
  const out = [];
  const re = /href="\/pets\/(\d+)"[\s\S]*?src="(\/game\/pets\/[^"]+)"[^>]*?alt="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) out.push({ no: m[1], img: m[2], name: decode(m[3]) });
  return out;
}

(async () => {
  fs.mkdirSync(CACHE, { recursive: true });

  // 1) 목록: 새 번호가 안 나올 때까지 (마지막 페이지를 넘기면 마지막 페이지가 반복된다)
  const order = [];
  const seen = new Set();
  for (let page = 1; page <= 50; page++) {
    const html = await getPage(`/pets?page=${page}`, `list-${page}.html`);
    if (!html) break;
    const items = parseList(html).filter(x => !seen.has(x.no));
    if (!items.length) break;
    for (const x of items) { seen.add(x.no); order.push(x.no); }
  }
  console.log(`목록: ${order.length}마리`);

  // 2) 상세
  const pets = [];
  const failed = [];
  for (const [i, no] of order.entries()) {
    try {
      const html = await getPage(`/pets/${no}`, `pet-${no}.html`);
      if (!html) { failed.push(no); continue; }
      const p = parseDetail(no, html);
      if (!p) { failed.push(no); console.warn(`파싱 실패 ${no}`); continue; }
      pets.push(p);
    } catch (e) {
      failed.push(no);
      console.warn(`실패 ${no}: ${e.message}`);
    }
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${order.length}`);
  }

  fs.writeFileSync(OUT, JSON.stringify(pets, null, 2), 'utf8');
  console.log(`저장: ${pets.length}마리 -> ${path.relative(ROOT, OUT)}${failed.length ? ` (실패 ${failed.length}: ${failed.join(',')})` : ''}`);
})();

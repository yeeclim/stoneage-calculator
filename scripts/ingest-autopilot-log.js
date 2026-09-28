#!/usr/bin/env node
/*
 * log/ 폴더의 오토파일럿 포획 로그(autopilot_gui.log / autopilot_detail.log)에서 고유 개체를 뽑아
 * data/field-samples.json 에 "추가만" 한다. 기존 개체는 절대 지우거나 덮어쓰지 않는다.
 *
 *   node scripts/ingest-autopilot-log.js      (npm run ingest:logs)
 *
 * 로그 원본은 git 에 올리지 않는다(.gitignore). 누적 데이터는 data/field-samples.json 이 유일한 원본이다.
 *
 * 개체 식별: 게임이 스캔마다 메모리 주소를 재할당하므로 주소로 중복 제거하면 안 된다(약 17배 팽창).
 * 세션 안에서 슬롯별 점유 개체(종+초기치)를 따라가고, "N번 자리 버림" 성공 이벤트로만 슬롯을 비운다.
 * 슬롯의 점유 개체가 바뀌면 새 개체로 센다.
 * 개체 키 = 세션시작시각|첫관측시각|슬롯|종|초기치. 같은 로그를 다시 넣거나, 이전 로그를 포함한
 * 더 긴 로그를 넣거나, gui/detail 두 형식에 같은 세션이 겹쳐도 중복되지 않는다. gui 와 detail 은
 * 같은 사건을 1초 어긋나게 찍는 경우가 있어 두 시각 모두 ±2초 이내면 같은 개체로 본다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'log');
const STORE = path.join(ROOT, 'data', 'field-samples.json');

const RE_PET = /\/페트 (\d): 0x[0-9a-f]+ \[([^\]]+)\] \{'내': \((-?\d+), (-?\d+)\), '공': \((-?\d+), (-?\d+)\), '방': \((-?\d+), (-?\d+)\), '순': \((-?\d+), (-?\d+)\)\}/;
const RE_DROP = /\] (\d)번 자리 버림/;
// gui: "[HH:MM:SS] ..."   detail: "YYYY-MM-DD HH:MM:SS\t..."
const lineTime = l => (l.match(/^\[(\d\d:\d\d:\d\d)\]/) || l.match(/^\d{4}-\d\d-\d\d (\d\d:\d\d:\d\d)\t/) || [])[1] || null;
const isSessionStart = l => l.includes('오토파일럿 시작') || l.includes('=== 상세 로그 시작');

function parse(file) {
  const out = [];
  let sess = null, slots = {};
  for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (isSessionStart(l)) { sess = lineTime(l); slots = {}; continue; }
    let m = l.match(RE_PET);
    if (m) {
      const slot = +m[1], sp = m[2];
      const raw = [+m[3], +m[5], +m[7], +m[9]];
      const off = [+m[4], +m[6], +m[8], +m[10]];
      const occ = sp + ':' + raw.join(',');
      if (slots[slot] !== occ) {
        slots[slot] = occ;
        out.push({ key: `${sess}|${lineTime(l)}|${slot}|${sp}|${raw.join(',')}`, sp, raw, off });
      }
      continue;
    }
    m = l.match(RE_DROP);
    if (m) delete slots[m[1]];
  }
  return out;
}

const store = fs.existsSync(STORE)
  ? JSON.parse(fs.readFileSync(STORE, 'utf8'))
  : { note: '', legacyCounts: {}, samples: [] };
const TOL = 2;
const sec = t => { const [h, m, x] = t.split(':').map(Number); return h * 3600 + m * 60 + x; };
const near = (a, b) => { const d = Math.abs(sec(a) - sec(b)); return Math.min(d, 86400 - d) <= TOL; };
const index = new Map(); // 슬롯|종|초기치 -> [[세션시각, 관측시각]]
const splitKey = k => { const [ss, seen, ...rest] = k.split('|'); return { ss, seen, base: rest.join('|') }; };
const remember = k => { const { ss, seen, base } = splitKey(k); (index.get(base) || index.set(base, []).get(base)).push([ss, seen]); };
const isKnown = k => { const { ss, seen, base } = splitKey(k); return (index.get(base) || []).some(([a, b]) => near(a, ss) && near(b, seen)); };
store.samples.forEach(s => remember(s.key));
const before = store.samples.length;

const files = fs.existsSync(LOG_DIR) ? fs.readdirSync(LOG_DIR).filter(f => /\.log$/i.test(f)) : [];
if (!files.length) { console.log('log/ 에 .log 파일이 없음'); process.exit(0); }

const today = new Date().toISOString().slice(0, 10);
for (const f of files) {
  const items = parse(path.join(LOG_DIR, f));
  let added = 0;
  for (const it of items) {
    if (isKnown(it.key)) continue;
    remember(it.key);
    store.samples.push({ ...it, src: f, added: today });
    added++;
  }
  console.log(`${f}: 개체 ${items.length} / 신규 ${added}`);
}

fs.mkdirSync(path.dirname(STORE), { recursive: true });
fs.writeFileSync(STORE, JSON.stringify(store, null, 0).replace(/\},\{"key"/g, '},\n{"key"'), 'utf8');

const bySp = {};
store.samples.forEach(s => bySp[s.sp] = (bySp[s.sp] || 0) + 1);
console.log(`누적 ${before} -> ${store.samples.length}마리`, JSON.stringify(bySp));

console.log('모델 재검증: node scripts/check-field-model.js');

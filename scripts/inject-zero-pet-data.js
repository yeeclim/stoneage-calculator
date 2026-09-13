/*
 * scripts/zero_pet_data.json (build-zero-pet-data.js 결과물) 을 index.html 의
 * <script id="pet-data-zero"> 블록에 통째로 주입(교체)한다.
 *
 * 사용법:
 *   node scripts/build-zero-pet-data.js   # zero_board23_pets.json -> zero_pet_data.json
 *   node scripts/inject-zero-pet-data.js  # zero_pet_data.json -> index.html 에 반영
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const DATA = path.join(__dirname, 'zero_pet_data.json');

const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const minified = JSON.stringify(data);

const html = fs.readFileSync(INDEX, 'utf8');
const TAG_RE = /<script type="application\/json" id="pet-data-zero">[\s\S]*?<\/script>/;
const EXTRA_MARKER = '<script type="application/json" id="pet-data-extra">[]</script>';
const newTag = `<script type="application/json" id="pet-data-zero">${minified}</script>`;

let updated;
if (TAG_RE.test(html)) {
  updated = html.replace(TAG_RE, newTag);
} else if (html.includes(EXTRA_MARKER)) {
  updated = html.replace(EXTRA_MARKER, EXTRA_MARKER + '\n' + newTag);
} else {
  console.error('pet-data-zero 태그도, 삽입 기준점(pet-data-extra)도 못 찾음 — index.html 구조 확인 필요');
  process.exit(1);
}

fs.writeFileSync(INDEX, updated, 'utf8');
console.log(`주입 완료: ${data.length}마리 -> index.html (${updated.length} bytes)`);

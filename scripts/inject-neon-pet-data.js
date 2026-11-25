/*
 * scripts/neon_pet_data.json (build-neon-pet-data.js 결과물) 을 index.html 의
 * <script id="pet-data-neon"> 블록에 통째로 주입(교체)한다. 블록이 없으면 pet-data-zero 바로 뒤에 만든다.
 *
 * 사용법:
 *   node scripts/scrape-neon.js            # neonine.cc -> neon_pets.json
 *   node scripts/build-neon-pet-data.js    # neon_pets.json -> neon_pet_data.json
 *   node scripts/inject-neon-pet-data.js   # neon_pet_data.json -> index.html
 *   node scripts/localize-images.js        # 이미지 -> images/pets/neon_*.png
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const DATA = path.join(__dirname, 'neon_pet_data.json');

const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
// </script> 가 데이터 안에 들어가면 블록이 끊기므로 '<' 를 이스케이프한다.
const minified = JSON.stringify(data).replace(/</g, '\\u003c');
const newTag = `<script type="application/json" id="pet-data-neon">${minified}</script>`;

const html = fs.readFileSync(INDEX, 'utf8');
const OPEN = '<script type="application/json" id="pet-data-neon">';
const ZERO_OPEN = '<script type="application/json" id="pet-data-zero">';

let updated;
const at = html.indexOf(OPEN);
if (at >= 0) {
  const end = html.indexOf('</script>', at) + '</script>'.length;
  updated = html.slice(0, at) + newTag + html.slice(end);
} else {
  const z = html.indexOf(ZERO_OPEN);
  if (z < 0) {
    console.error('pet-data-neon 태그도, 삽입 기준점(pet-data-zero)도 못 찾음 — index.html 구조 확인 필요');
    process.exit(1);
  }
  const zEnd = html.indexOf('</script>', z) + '</script>'.length;
  updated = html.slice(0, zEnd) + '\n' + newTag + html.slice(zEnd);
}

fs.writeFileSync(INDEX, updated, 'utf8');
console.log(`주입 완료: ${data.length}마리 -> index.html (${updated.length} bytes)`);

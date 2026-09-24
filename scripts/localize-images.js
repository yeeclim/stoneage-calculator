#!/usr/bin/env node
/*
 * index.html 의 pet-data-extra(오르) / pet-data-zero(제로) 에 들어있는 외부 이미지 URL
 * (https://...gif) 을 images/pets/<id>.<ext> 로 내려받고, index.html 의 해당 URL 을
 * 상대경로(images/pets/<id>.<ext>)로 치환한다. 이미 받은 파일은 건너뛴다.
 *
 * 스크랩/머지/inject 를 다시 돌리면 img 가 외부 URL 로 되돌아오므로 그 뒤에 이 스크립트를
 * 한 번 더 실행할 것.
 *
 * 사용법: node scripts/localize-images.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const DIR = path.join(ROOT, 'images', 'pets');
const IDS = ['pet-data-extra', 'pet-data-zero'];

const extOf = b => b.slice(0, 4).toString() === 'GIF8' ? 'gif'
  : b.slice(0, 4).toString() === 'RIFF' ? 'webp'
  : b[0] === 0x89 ? 'png' : b[0] === 0xff ? 'jpg' : null;

(async () => {
  let html = fs.readFileSync(INDEX, 'utf8');
  fs.mkdirSync(DIR, { recursive: true });
  let done = 0, skipped = 0, failed = 0;

  for (const tagId of IDS) {
    const m = html.match(new RegExp(`(<script type="application/json" id="${tagId}">)([^]*?)(</script>)`));
    if (!m) { console.warn(`${tagId} 블록 없음`); continue; }
    const pets = JSON.parse(m[2]);
    let body = m[2];
    for (const p of pets) {
      if (!/^https?:/.test(p.img || '')) continue;
      const existing = fs.readdirSync(DIR).find(f => path.parse(f).name === p.id);
      let file = existing;
      if (file) skipped++;
      else {
        try {
          const r = await fetch(p.img, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const buf = Buffer.from(await r.arrayBuffer());
          const ext = extOf(buf);
          if (!ext) throw new Error('이미지 아님');
          file = `${p.id}.${ext}`;
          fs.writeFileSync(path.join(DIR, file), buf);
          done++;
        } catch (e) { failed++; console.warn(`실패 ${p.id} ${p.name}: ${e.message}`); continue; }
      }
      body = body.split(JSON.stringify(p.img).slice(1, -1)).join(`images/pets/${file}`);
    }
    html = html.replace(m[0], () => m[1] + body + m[3]);
  }
  fs.writeFileSync(INDEX, html, 'utf8');
  console.log(`다운로드 ${done}, 기존 ${skipped}, 실패 ${failed}`);
})();

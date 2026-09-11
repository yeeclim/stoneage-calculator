# 스톤에이지 환각 계산기

스톤에이지 펫 환각(성장) 계산기. `index.html` 하나로 동작하는 정적 페이지이며, 펫 데이터와 이미지는 파일에 모두 내장되어 있다.

## 구성

- `index.html` — 계산기 본체. 펫 데이터와 이미지가 전부 파일 안에 내장되어 있어 외부 의존성은 Google Fonts뿐이다.
  - `<script id="pet-data">` — 원본계수·k 역산이 끝난 정밀/근사 지원 개체(현재 142마리). `img` 필드는 접두어 없는 raw base64 webp.
  - `<script id="pet-data-extra">` — 아직 역산 전인 "근사 추정" 개체(현재 23마리, `approx:true`, `ok:false`). `img` 필드는 ohrsa.net 원격 URL.
  - `<script id="rank-compare-data">` — RANK 1~6 표기값 대 계산값 비교용 데이터.
  - 렌더링은 항상 `imgSrc(p)` 헬퍼를 거친다: `img` 가 `http`로 시작하면 그대로, 아니면 `data:image/webp;base64,` 를 붙여서 사용한다. **`images/` 폴더는 index.html 이 전혀 참조하지 않는다** — 아래 참고용 데이터 전용이다.
- `ohrsa_pets.json` (루트) — 예전 ohrsa.net 크롤링 결과, 참고용. `img` 필드가 `images/0000.gif` 처럼 로컬 상대경로로 되어 있다(외부 링크 차단 대비, commit c6e043a). index.html 과는 별개의 데이터셋이며 이름은 대부분 겹치지만 id·필드 구조가 다르다.
- `images/` — 루트 `ohrsa_pets.json` 이 참조하는 펫 이미지 로컬 사본(파일명은 그 파일의 `i` 값을 0-padding, 예: `0000.gif`). `scripts/ohrsa_pets.json` 로 새로 추가되는 "근사 추정" 개체 이미지도 여기 펫 이름으로 저장된다(예: `고루루.gif`). 둘 다 index.html 실행에는 불필요한, 순수 참고/캐시 자산.
- `scripts/scrape-ohrsa.console.js` — ohrsa.net 도감을 긁어 `{i, name, attrs, obtain, sell, 기술창, 탑승, 성장률표기, init_내공방순, growth_내공방순, img, raw}` 형태 JSON을 만드는 브라우저 콘솔 스크립트.
- `scripts/ohrsa_pets.json` — 위 스크레이퍼로 새로 뽑은 원시 스크랩 결과(주로 아직 `pet-data`/`pet-data-extra` 에 없는 신규 개체). git에 커밋하지 않고 매번 새로 스크랩해 써도 된다.
- `scripts/add-validate-merge.js` (`node scripts/add-validate-merge.js`) — `scripts/ohrsa_pets.json` 을 읽어 `index.html` 의 기존 `pet-data` 와 이름이 겹치지 않는 항목만 골라 `initS/growthS/attr` 등을 정규화한 뒤 `pet-data-extra` 블록을 통째로 교체한다. 원본계수 역산은 하지 않으므로 결과는 전부 `approx:true`.
- `scripts/download-ohrsa-images.ps1` — `scripts/ohrsa_pets.json` 에 나온 이미지 URL을 `images/<펫이름>.<확장자>` 로 내려받는다(이미 있으면 skip). index.html 은 이 파일들을 읽지 않으며, 순수 로컬 캐시/오프라인 참고용이다.
- `scripts/check-missing-images.js` (`node scripts/check-missing-images.js`) — `scripts/ohrsa_pets.json` 과 `index.html` 의 `pet-data-extra` 에 나오는 펫 이름 기준으로 `images/` 에 대응 파일이 있는지 점검한다.

## 데이터 갱신 (근사 추정 개체 추가)

1. ohrsa.net 펫 목록 페이지에서 `scripts/scrape-ohrsa.console.js` 를 콘솔 실행 → 다운로드된 파일을 `scripts/ohrsa_pets.json` 으로 저장.
2. `node scripts/add-validate-merge.js` 실행 → `index.html` 의 `pet-data-extra` 블록이 신규 개체를 포함해 갱신됨(기존 `pet-data` 와 이름이 겹치는 항목은 자동 스킵).
3. (선택) `scripts\download-ohrsa-images.ps1` 로 이미지를 `images/` 에 로컬 캐시, `node scripts/check-missing-images.js` 로 누락 확인. index.html 자체는 이 이미지들과 무관하게 ohrsa.net 원격 URL로 바로 렌더링한다.
4. 원본계수(`origin`)·`k` 를 역산해 `ok:true` 로 승격하고 싶으면(=정밀 계산 지원), 해당 항목을 `pet-data` 블록으로 수동 이관하고 `approx`/`ok` 를 갱신한다. `RANK_COMPARE`(`rank-compare-data`)에도 대응 항목을 추가해야 "성장률·초기치 비교" 탭이 동작한다.
5. `git push` → Vercel 자동 재배포.

## 배포

정적 호스팅에 루트로 올리면 된다. Vercel 기준 별도 빌드 설정 불필요.
GitHub 레포 연동됨 → `main` push 시 자동 재배포.

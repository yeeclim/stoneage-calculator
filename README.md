# 스톤에이지 환각 계산기

스톤에이지 펫 환각(성장) 계산기. `index.html` 하나로 동작하는 정적 페이지이며, 펫 데이터와 이미지는 파일에 모두 내장되어 있다.

## 구성

- `index.html` — 계산기 본체 (펫 데이터·이미지 base64 내장, 외부 의존성은 Google Fonts뿐)
- `ohrsa_pets.json` — 펫 원본 데이터 (ohrsa.net 크롤링 결과, 참고용)
- `images/` — `ohrsa_pets.json` 이 참조하는 펫 이미지 로컬 사본
- `scripts/scrape-ohrsa.console.js` — ohrsa.net 도감을 긁어 `ohrsa_pets.json` 을 만드는 브라우저 콘솔 스크립트

## 데이터 갱신

1. ohrsa.net 펫 목록 페이지에서 `scripts/scrape-ohrsa.console.js` 를 콘솔 실행 → `ohrsa_pets.json` 다운로드
2. 받은 파일로 루트의 `ohrsa_pets.json` 교체
3. (아직 수동) 스크레이퍼 출력 → `index.html` 의 `<script id="pet-data">` 구조로 변환
   - 스크레이퍼: `init_내공방순`, `growth_내공방순`, 외부 img URL
   - 계산기: `initS`, `growthS`, `origin`(원본계수), `k`, `ok`, `approx`, base64 img
4. `git push` → Vercel 자동 재배포

## 배포

정적 호스팅에 루트로 올리면 된다. Vercel 기준 별도 빌드 설정 불필요.
GitHub 레포 연동됨 → `main` push 시 자동 재배포.

<div align="center">

# 🦖 스톤에이지 환각 계산기

**포획한 펫의 초기치만 넣으면 등급(환각) 확률을 알려주는 계산기**

[![Live](https://img.shields.io/badge/Live-stoneage--calculator.vercel.app-000?logo=vercel)](https://stoneage-calculator.vercel.app)
![Static](https://img.shields.io/badge/빌드-없음_%28index.html_하나%29-2ea44f)
![Pets](https://img.shields.io/badge/도감-오르_360_·_제로_210-blue)

</div>

---

## ✨ 기능

| 탭 | 내용 |
|---|---|
| **오르** | Lv1 초기치 → 178,750가지 조합(등급오프셋 5⁴ × 보너스 분배 286)을 대조해 등급별 확률 표시. |
| **성장률·초기치 비교** | RANK 1~6 표기값과 계산값 비교 |
| **제로** | 스톤에이지 제로(별개 서버) 도감. 오르와 값이 달라 데이터를 분리해 둔다. |

- 🧪 **맹독 데미지**: 포획 전에 맹독 데미지로 정석 여부를 거를 수 있는지 판단 (서버 `battle.c` 공식)
- 🔁 **환생·진화 형태 전환**: 상세 화면의 버튼으로 원본 ↔ 환생 ↔ 진화 전환
- 📈 **등급 상세**: 등급 행을 펼치면 해당 조합(오프셋·보너스) 목록이 나오고, 📈 버튼으로 등급별 성장률 범위를 본다

## 🧮 계산 모델

```
원값   r_i = k × (origin_i + 등급오프셋_i + 보너스_i)
표기값      = floor(M · r × 0.01)        M = [[4,1,1,1],[.1,1,.1,.05],[.1,.1,1,.05],[0,0,0,1]]
```

- **등급오프셋**: 스탯마다 −2~+2 균등. 네 오프셋의 합이 등급(−8~+8)이다.
- **보너스 10포인트**: 1포인트씩 4스탯에 독립으로 배분 (다항분포)
- **연산 순서**: 서버(gmsv `CHAR_complianceParameter`)와 같은 순서로 계산한다. 순서가 다르면 부동소수 내림 결과가 갈린다.
- **origin·k 역산**: 도감의 초기치와 3자리 성장률로 [`solve-origin-k.js`](scripts/solve-origin-k.js)가 정수해를 찾는다. 정석(+8)이 정수 보너스로 재현돼야 채택한다.

## 📁 구조

```
index.html                 계산기 본체 (데이터 내장, 외부 의존은 Google Fonts뿐)
├─ #pet-data               오르 정밀 지원 165마리 (이미지 base64 webp 내장)
├─ #pet-data-extra         오르 추가 195마리 (환생·진화 88 포함, images/pets/ 경로)
├─ #rank-compare-data      RANK 비교 142건
└─ #pet-data-zero          제로 도감 210마리
images/pets/               오르·제로 펫 이미지
scripts/                   스크랩·역산·주입·검증 스크립트
```

## 🛠 데이터 작업

### npm 스크립트

| 명령 | 하는 일 |
|---|---|
| `npm run scrape:ohrsa` | ohrsa.net 도감 스크랩 (Playwright, 로그인 필요) |
| `npm run merge:auto` | 스크랩 결과 중 신규 펫만 `pet-data-extra`에 추가 (역산 자동 연결) |
| `npm run scrape:zero` | 제로 도감 스크랩 (`scripts/sathezero.local.env` 필요) |
| `npm run localize:images` | 새 이미지를 `images/pets/`로 내려받고 경로 치환 |

### 제로 도감 갱신

```bash
npm run scrape:zero                      # → scripts/zero_board23_pets.json
node scripts/build-zero-pet-data.js      # → scripts/zero_pet_data.json (origin·k 역산)
node scripts/inject-zero-pet-data.js     # → index.html #pet-data-zero 교체
npm run localize:images
```

수동 보정 파일:
- `scripts/zero_manual_pets.json`: 게시판에 없는 개체
- `scripts/zero_growth_overrides.json`: 게시판 성장률 오기 정정
- `scripts/zero_legacy_board23_pets.json`: 개편 전 목록에만 있는 개체 유지

### 오르 보정

`scripts/ohrsa_overrides.json`에 ohrsa 표기가 틀린 개체의 게임 화면 기준 초기치·성장률을 적는다. 키는 `이름|형태` 형식이다(예: `만모|환생`).

### 로컬 자동 스크랩

ohrsa.net은 Cloudflare 봇 차단 때문에 GitHub Actions에서 접근이 막힌다. 그래서 개인 PC의 작업 스케줄러로 [`run-ohrsa-scrape-local.ps1`](scripts/run-ohrsa-scrape-local.ps1)을 주기 실행한다. 이 스크립트는 스크랩 → 머지 → 제로 갱신 → 이미지 → **`main` 자동 커밋·푸시**까지 진행한다.
설치 방법은 [scripts/README-local-scrape.md](scripts/README-local-scrape.md)를 참고한다.

## 🚀 배포

GitHub `yeeclim/stoneage-calculator` ↔ Vercel 연동. **`main`에 push하면 자동 배포**되고 빌드 설정은 없다.

# ohrsa.net petinfo 자동 스크랩 — 로컬(Windows 작업 스케줄러) 설치 가이드

GitHub Actions(클라우드 IP)로 시도했으나 Cloudflare 봇 차단(`Just a moment...` 챌린지
페이지)에 걸려서 접근 자체가 안 됨. 항상 켜두는 개인 PC — 평소 브라우저로 ohrsa.net에
정상적으로 접속되는 그 네트워크 — 에서 Windows 작업 스케줄러로 주기 실행하는 방식으로
대체한다.

## 1. 사전 준비 (최초 1회)

```powershell
git clone https://github.com/yeeclim/stoneage-calculator.git
cd stoneage-calculator
npm install
npx playwright install chromium
```

## 2. 로그인 정보 파일 생성

`scripts\ohrsa.local.env` 파일을 새로 만들고 아래 내용을 채운다.
(`.gitignore`에 등록되어 있어 절대 커밋되지 않음.)

```
OHRSA_USERNAME=아이디
OHRSA_PASSWORD=비밀번호
```

## 3. git push가 무인 실행 가능한지 확인

작업 스케줄러는 사람이 지켜보지 않으므로, 이 저장소에서 `git push`가 아이디/비밀번호
입력창 없이 되는 상태여야 한다 (Git Credential Manager에 이미 로그인되어 있거나,
`origin` 리모트가 SSH + 등록된 키 사용 중이면 OK). 아래 명령으로 한번 확인:

```powershell
git push origin main
```

## 4. 수동 테스트

작업 스케줄러에 등록하기 전에 반드시 한 번 수동으로 돌려서 정상 동작하는지 확인한다.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\run-ohrsa-scrape-local.ps1
```

`scripts\ohrsa-scrape.log` 에 실행 로그가 쌓인다. 로그인 성공 → petinfo 진입 →
카드 수집 → (신규 있으면) 커밋/푸시까지 확인할 것.

## 5. Windows 작업 스케줄러 등록 (주1회)

등록 스크립트를 쓰면 된다. **관리자 권한 불필요** (본인 계정 작업으로 등록됨).

```powershell
powershell -ExecutionPolicy Bypass -File scripts\register-scrape-task.ps1
```

기본값은 **매주 일요일 10:00**. 다른 요일/시각으로 바꾸려면:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\register-scrape-task.ps1 -DayOfWeek Monday -At 21:30
```

이미 같은 이름의 작업이 있으면 지우고 다시 등록하므로, 주기만 바꿀 때도 그냥 다시 실행하면 된다.

### 등록되는 설정과 그 이유

| 설정 | 이유 |
| --- | --- |
| `-StartWhenAvailable` | 그 시각에 PC가 꺼져 있었어도 다음에 켜지면 놓친 실행을 따라잡음 |
| 로그온 중일 때만 실행 (`Interactive`) | Git Credential Manager 토큰이 DPAPI로 사용자 세션에 묶여 있음. 로그오프 상태(S4U)로 돌리면 `git push` 인증이 깨질 수 있음 |
| `-ExecutionTimeLimit 1시간` | 한 번 멈춘 실행이 영구히 남아 다음 주 실행을 막는 것 방지 |
| `-MultipleInstances IgnoreNew` | 이전 실행이 아직 돌고 있으면 새 실행을 건너뜀 |
| `-RestartCount 2` | 일시적 네트워크 실패 시 30분 간격으로 2회 재시도 |

## 6. 등록 확인 / 수동 실행 / 삭제

```powershell
Get-ScheduledTask -TaskName "ohrsa-petinfo-scrape" | Get-ScheduledTaskInfo   # 다음/마지막 실행 시각
Start-ScheduledTask -TaskName "ohrsa-petinfo-scrape"                          # 즉시 한번 실행
Get-Content scripts\ohrsa-scrape.log -Tail 40                                 # 실행 로그 확인
Unregister-ScheduledTask -TaskName "ohrsa-petinfo-scrape" -Confirm:$false     # 삭제
```

## 참고

- `scripts/scrape-ohrsa.playwright.js` — 로그인 후 petinfo를 열어
  `scrape-ohrsa.console.js`와 동일한 DOM 파싱 로직을 실행, `scripts/ohrsa_pets_auto.json`
  에 원본 스크랩 결과 저장(gitignore됨, 로컬 파일).
- `scripts/merge-auto-scrape.js` — 그 결과 중 `pet-data`(base)와 기존 `pet-data-extra`
  양쪽 모두에 없는 진짜 신규 펫만 골라 기존 `pet-data-extra` 뒤에 이어붙인다
  (기존 수동 등록 개체를 절대 지우지 않음).
- 둘 다 실패해도 index.html은 안 건드리므로 주1회 조용히 실패만 해도 안전(no-op).
- `scripts/register-scrape-task.ps1` — 위 주1회 작업 스케줄러 등록/재등록 스크립트.

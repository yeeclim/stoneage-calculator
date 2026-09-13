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

## 5. Windows 작업 스케줄러 등록

관리자 권한 PowerShell에서 (경로는 실제 클론 위치에 맞게 수정):

```powershell
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument '-ExecutionPolicy Bypass -File "C:\경로\stoneage-calculator\scripts\run-ohrsa-scrape-local.ps1"'
$trigger = New-ScheduledTaskTrigger -Daily -At 9:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd
Register-ScheduledTask -TaskName "ohrsa-petinfo-scrape" `
  -Action $action -Trigger $trigger -Settings $settings `
  -Description "ohrsa.net petinfo 자동 스크랩 -> stoneage-calculator 반영"
```

- `-StartWhenAvailable`: PC가 그 시간에 꺼져있었어도 켜지면 놓친 실행을 바로 수행.
- 로그인 세션이 필요한 작업(브라우저 실행)이라 "사용자가 로그온했을 때만 실행"이
  기본값이면 충분함 — 노트북을 항상 켜두고 로그인 상태로 둔다면 문제 없음.

## 6. 등록 확인 / 수동 실행 / 삭제

```powershell
Get-ScheduledTask -TaskName "ohrsa-petinfo-scrape"
Start-ScheduledTask -TaskName "ohrsa-petinfo-scrape"   # 즉시 한번 실행해보기
Unregister-ScheduledTask -TaskName "ohrsa-petinfo-scrape" -Confirm:$false  # 삭제
```

## 참고

- `scripts/scrape-ohrsa.playwright.js` — 로그인 후 petinfo를 열어
  `scrape-ohrsa.console.js`와 동일한 DOM 파싱 로직을 실행, `scripts/ohrsa_pets_auto.json`
  에 원본 스크랩 결과 저장(gitignore됨, 로컬 파일).
- `scripts/merge-auto-scrape.js` — 그 결과 중 `pet-data`(base)와 기존 `pet-data-extra`
  양쪽 모두에 없는 진짜 신규 펫만 골라 기존 `pet-data-extra` 뒤에 이어붙인다
  (기존 수동 등록 개체를 절대 지우지 않음).
- 둘 다 실패해도 index.html은 안 건드리므로 매일 조용히 실패만 해도 안전(no-op).

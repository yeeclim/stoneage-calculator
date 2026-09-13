# ohrsa.net petinfo 자동 스크랩 - 로컬(Windows 작업 스케줄러)용 오케스트레이션 스크립트.
#
# GitHub Actions(클라우드 IP)는 Cloudflare 봇 차단에 걸려서 못 씀 - 항상 켜두는
# 개인 PC에서 Windows 작업 스케줄러로 이 스크립트를 주기 실행하는 방식으로 대체.
#
# 사전 준비 (최초 1회):
#   1. 이 저장소를 클론해둔다.
#   2. npm install
#   3. npx playwright install chromium
#   4. scripts\ohrsa.local.env 파일을 만들고 아래 두 줄을 채운다 (git에 커밋되지 않음):
#        OHRSA_USERNAME=아이디
#        OHRSA_PASSWORD=비밀번호
#   5. 이 저장소에서 git push 가 이미 대화형 인증 없이 되는 상태여야 한다
#      (Git Credential Manager 로그인 되어있거나 SSH 키 등록된 상태).
#
# 수동 테스트: powershell -File scripts\run-ohrsa-scrape-local.ps1
# 작업 스케줄러 등록 예시는 scripts\README-local-scrape.md 참고.

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$logFile = Join-Path $PSScriptRoot 'ohrsa-scrape.log'
function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path $logFile -Value $line
}

$envFile = Join-Path $PSScriptRoot 'ohrsa.local.env'
if (-not (Test-Path $envFile)) {
  Log "오류: $envFile 없음. OHRSA_USERNAME/OHRSA_PASSWORD 를 담은 파일을 먼저 만들어야 함."
  exit 1
}
Get-Content $envFile | Where-Object { $_ -match '=' -and $_ -notmatch '^\s*#' } | ForEach-Object {
  $parts = $_ -split '=', 2
  [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), 'Process')
}
if (-not $env:OHRSA_USERNAME -or -not $env:OHRSA_PASSWORD) {
  Log "오류: OHRSA_USERNAME / OHRSA_PASSWORD 가 $envFile 안에 없음."
  exit 1
}

Log "=== 실행 시작 ==="

try {
  Log "git pull..."
  git pull --ff-only 2>&1 | ForEach-Object { Log $_ }

  Log "스크랩 실행..."
  $scrapeOut = node scripts/scrape-ohrsa.playwright.js 2>&1
  $scrapeOut | ForEach-Object { Log $_ }
  if ($LASTEXITCODE -ne 0) {
    Log "스크랩 실패 (exit $LASTEXITCODE) - 종료."
    exit 1
  }

  Log "병합 실행..."
  $mergeOut = node scripts/merge-auto-scrape.js 2>&1
  $mergeOut | ForEach-Object { Log $_ }
  if ($LASTEXITCODE -ne 0) {
    Log "병합 실패 (exit $LASTEXITCODE) - 종료."
    exit 1
  }

  if ($mergeOut -match '^CHANGED$') {
    $addedLine = ($mergeOut | Where-Object { $_ -match '^추가된 펫:' })
    Log "변경 감지 -> 커밋/푸시 진행. $addedLine"
    git add index.html
    git commit -m "ohrsa.net 도감 자동 스크랩(로컬): 신규 펫 추가"
    git push
    Log "푸시 완료."
  } else {
    Log "신규 펫 없음 - 변경 없음."
  }
}
catch {
  Log "예외 발생: $_"
  exit 1
}

Log "=== 실행 종료 ==="

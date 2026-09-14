# ohrsa.net petinfo 자동 스크랩 - 로컬(Windows 작업 스케줄러)용 오케스트레이션 스크립트.
#
# GitHub Actions(클라우드 IP)는 Cloudflare 봇 차단에 걸려서 못 씀 - 항상 켜두는
# 개인 PC에서 Windows 작업 스케줄러로 이 스크립트를 주1회 실행하는 방식으로 대체.
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
# 수동 테스트: powershell -ExecutionPolicy Bypass -File scripts\run-ohrsa-scrape-local.ps1
# 작업 스케줄러 등록은 scripts\register-scrape-task.ps1 참고.

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

# 무인 실행: git이 어떤 상황에서도 자격증명 입력창/프롬프트를 띄우지 못하게 막는다.
# (이게 없으면 토큰 만료 시 작업이 조용히 영원히 멈춘 채 남는다.)
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'Never'

$logFile = Join-Path $PSScriptRoot 'ohrsa-scrape.log'

# 로그 회전: 1MB 넘으면 뒤쪽 2000줄만 남기고 잘라낸다 (주1회라도 몇 년 쌓이면 커짐).
if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 1MB)) {
  $keep = Get-Content $logFile -Tail 2000
  Set-Content -Path $logFile -Value $keep -Encoding UTF8
}

function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path $logFile -Value $line -Encoding UTF8
}

# node/git 는 UTF-8로 출력하는데 Windows PowerShell 5.1은 자식 프로세스 stdout을
# 콘솔 코드페이지(CP949)로 읽는다 -> 한글이 깨져서 로그도 못 읽고 문자열 매칭도 실패한다.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# git/node 는 정상 동작 중에도 stderr에 진행 상황을 쓴다 (예: git push의 "To https://...").
# $ErrorActionPreference='Stop' 상태에서 2>&1 로 합치면 그 줄이 ErrorRecord가 되어
# 종료 예외로 바뀐다 -> 성공한 push가 실패로 보고되던 문제. 네이티브 호출 동안만 Continue.
function Invoke-Logged {
  param(
    [Parameter(Mandatory)][string]$Exe,
    [Parameter(ValueFromRemainingArguments)][string[]]$CmdArgs
  )
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $Exe @CmdArgs 2>&1 | ForEach-Object { "$_" }
    $script:LastNativeExit = $LASTEXITCODE
    $out | ForEach-Object { Log $_ }
    return $out
  }
  finally { $ErrorActionPreference = $prev }
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
  # 로컬에 커밋 안 된 변경이 있으면 pull --ff-only 가 깨지므로 먼저 확인하고 중단.
  $dirty = & git status --porcelain -- index.html
  if ($dirty) {
    Log "중단: index.html 에 커밋되지 않은 로컬 변경이 있음. 수동 정리 후 다시 실행할 것."
    Log $dirty
    exit 1
  }

  Log "git pull..."
  Invoke-Logged git pull --ff-only | Out-Null
  if ($script:LastNativeExit -ne 0) {
    Log "git pull 실패 (exit $script:LastNativeExit) - 종료. (로컬/원격 이력이 갈라졌거나 인증 만료)"
    exit 1
  }

  Log "스크랩 실행..."
  Invoke-Logged node scripts/scrape-ohrsa.playwright.js | Out-Null
  if ($script:LastNativeExit -ne 0) {
    Log "스크랩 실패 (exit $script:LastNativeExit) - 종료."
    exit 1
  }

  Log "병합 실행..."
  $mergeOut = Invoke-Logged node scripts/merge-auto-scrape.js
  if ($script:LastNativeExit -ne 0) {
    Log "병합 실패 (exit $script:LastNativeExit) - 종료."
    exit 1
  }

  if ($mergeOut -match '^CHANGED$') {
    $addedLine = ($mergeOut | Where-Object { $_ -match '^추가된 펫:' })
    Log "변경 감지 -> 커밋/푸시 진행. $addedLine"

    Invoke-Logged git add index.html | Out-Null

    Invoke-Logged git commit -m "ohrsa.net 도감 자동 스크랩(로컬): 신규 펫 추가" | Out-Null
    if ($script:LastNativeExit -ne 0) {
      Log "커밋 실패 (exit $script:LastNativeExit) - 푸시 생략하고 종료."
      exit 1
    }

    Invoke-Logged git push | Out-Null
    if ($script:LastNativeExit -ne 0) {
      Log "푸시 실패 (exit $script:LastNativeExit). 커밋은 로컬에 남아있음 - 인증 상태 확인 후 수동 push 필요."
      exit 1
    }
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
exit 0

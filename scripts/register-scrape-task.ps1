<#
.SYNOPSIS
  ohrsa.net petinfo 주1회 자동 스크랩을 Windows 작업 스케줄러에 등록한다.

.DESCRIPTION
  GitHub Actions는 Cloudflare 봇 차단에 걸려 못 쓰므로, 평소 ohrsa.net에 정상
  접속되는 개인 PC에서 주1회 실행하는 방식으로 대체한다.

  "사용자가 로그온했을 때만 실행"으로 등록한다. 이유:
    - Git Credential Manager의 토큰이 DPAPI로 사용자 세션에 묶여 있어서,
      로그오프 상태(S4U)로 돌리면 git push 인증이 깨질 수 있다.
    - -StartWhenAvailable 덕분에 그 시각에 PC가 꺼져 있었어도 다음 로그온 시
      놓친 실행을 자동으로 따라잡는다.

  관리자 권한 없이도 본인 계정 작업으로 등록된다.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\register-scrape-task.ps1
  # 기본값: 매주 일요일 10:00

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\register-scrape-task.ps1 -DayOfWeek Monday -At 21:30
#>
[CmdletBinding()]
param(
  [ValidateSet('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')]
  [string]$DayOfWeek = 'Sunday',
  [string]$At = '10:00',
  [string]$TaskName = 'ohrsa-petinfo-scrape'
)

$ErrorActionPreference = 'Stop'

$runner = Join-Path $PSScriptRoot 'run-ohrsa-scrape-local.ps1'
if (-not (Test-Path $runner)) { throw "실행 스크립트를 찾을 수 없음: $runner" }
$runner = (Resolve-Path $runner).Path

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $DayOfWeek -At $At

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
  -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 30)

# 로그온 중일 때만 실행 (GCM 자격증명 접근 보장). 관리자 권한 불필요.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "기존 작업 '$TaskName' 제거 후 재등록합니다."
}

Register-ScheduledTask -TaskName $TaskName `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description "ohrsa.net petinfo 주1회 자동 스크랩 -> stoneage-calculator index.html 반영 및 push" | Out-Null

$info = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
Write-Host ""
Write-Host "등록 완료: $TaskName"
Write-Host "  주기      : 매주 $DayOfWeek $At"
Write-Host "  실행 대상 : $runner"
Write-Host "  다음 실행 : $($info.NextRunTime)"
Write-Host ""
Write-Host "즉시 테스트 : Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "실행 로그   : scripts\ohrsa-scrape.log"
Write-Host "작업 삭제   : Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"

# Download images referenced in scripts\ohrsa_pets.json to ../images/
# Usage: run from PowerShell: .\download-ohrsa-images.ps1
# Behaviour:
# - Skips files that already exist
# - Names files as <sanitized-name>.<ext> (matches the lookup convention
#   used by check-missing-images.js and by index.html's own pet-name keys)
# - Retries up to 3 times on failure
# - Minimised per-file logging; prints a concise summary and warnings for failures

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$jsonPath = Join-Path $scriptDir 'ohrsa_pets.json'
$imagesDir = Join-Path $scriptDir '..\images'
$imagesDir = Resolve-Path -Path $imagesDir -ErrorAction SilentlyContinue | ForEach-Object { $_.Path } 
if (-not $imagesDir) { $imagesDir = Join-Path $scriptDir '..\images'; New-Item -ItemType Directory -Path $imagesDir | Out-Null; $imagesDir = (Resolve-Path $imagesDir).Path }

if (-not (Test-Path $jsonPath)) { Write-Error "JSON not found: $jsonPath"; exit 1 }

$json = Get-Content -Raw -Path $jsonPath | ConvertFrom-Json
if (-not $json) { Write-Error "Failed to parse JSON"; exit 1 }

$downloaded = 0; $skipped = 0; $failed = 0
$failedList = @()

foreach ($item in $json) {
    $img = $null
    if ($item.PSObject.Properties.Name -contains 'img') { $img = $item.img }
    elseif ($item.PSObject.Properties.Name -contains '이미지') { $img = $item.'이미지' }
    if (-not $img) { continue }
    if ($img -notmatch '^https?://') { $skipped++; continue }

    # Build filename
    $name = ($item.name -as [string]) -replace '[\\/:*?"<>|]', '' -replace '\s+', '_'
    try { $uri = [System.Uri]$img } catch { $failed++; $failedList += @{name=$item.name; url=$img; reason='Invalid URL'}; continue }
    $ext = [System.IO.Path]::GetExtension($uri.AbsolutePath)
    if (-not $ext) { $ext = '.gif' }
    $filename = "$name$ext"
    # sanitize filename further
    $filename = ($filename -replace '[^0-9A-Za-z_\-\.\uAC00-\uD7A3]', '')
    $target = Join-Path $imagesDir $filename
    if (Test-Path $target) { $skipped++; continue }

    $tries = 0; $max = 3; $ok = $false
    while ($tries -lt $max -and -not $ok) {
        try {
            Invoke-WebRequest -Uri $img -OutFile $target -UseBasicParsing -ErrorAction Stop
            $ok = $true; $downloaded++ 
        } catch {
            $tries++; Start-Sleep -Seconds 1
            if ($tries -ge $max) { $failed++; $failedList += @{name=$item.name; url=$img; reason=$_.Exception.Message} }
        }
    }
}

Write-Output "Download summary: Downloaded=$downloaded, Skipped=$skipped, Failed=$failed"
if ($failed -gt 0) {
    Write-Output "Failures:"
    foreach ($f in $failedList) { Write-Output " - $($f.name) -> $($f.url) : $($f.reason)" }
}
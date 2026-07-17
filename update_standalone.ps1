#Requires -Version 5.1
<#
Updates an existing ITDA standalone install in place, from GitHub - source
only (itda/, web/, Fonts/, itda_standalone.py, pyproject.toml). Never touches
input/, output/, python_embeded/, ffmpeg/, or anything else user data lives
in. Run this from inside the installed folder (Update_ITDA_Standalone.bat,
which sits next to it, is the normal way to launch it).
#>

$ErrorActionPreference = "Stop"
$InstallPath = $PSScriptRoot
$RepoUrl = "https://github.com/designloves2/itda.git"
$RepoZipUrl = "https://github.com/designloves2/itda/archive/refs/heads/main.zip"
$TrackedItems = @("itda", "web", "Fonts", "itda_standalone.py", "pyproject.toml")
# Deliberately excludes update_standalone.ps1 / Update_ITDA_Standalone.bat -
# cmd.exe reads a .bat file line-by-line as it executes it, so replacing the
# very file it's mid-way through running (this one, launched from the .bat)
# corrupts its read position and throws garbage syntax errors right after
# this script's own output finishes. These two rarely change; if they ever
# do, a fresh install picks up the new versions.

Write-Host ""
Write-Host "=== ITDA Standalone Update ===" -ForegroundColor Cyan

if (Test-Path (Join-Path $InstallPath ".git")) {
    Write-Host "Pulling latest from GitHub (git)..." -ForegroundColor Cyan
    Push-Location $InstallPath
    try {
        git pull --ff-only origin main
    } catch {
        Write-Host "git pull failed - if you have local edits in this folder, that's why (fast-forward only)." -ForegroundColor Yellow
        Pop-Location
        exit 1
    }
    Pop-Location
} else {
    $GitAvailable = [bool](Get-Command git -ErrorAction SilentlyContinue)
    if ($GitAvailable) {
        Write-Host "This install isn't a git checkout - re-cloning source into a temp folder and copying over..." -ForegroundColor Cyan
        $Tmp = Join-Path $env:TEMP "itda_update_clone"
        if (Test-Path $Tmp) { Remove-Item $Tmp -Recurse -Force }
        git clone --branch main --depth 1 $RepoUrl $Tmp
        foreach ($item in $TrackedItems) {
            $src = Join-Path $Tmp $item
            if (-not (Test-Path $src)) { continue }
            $dst = Join-Path $InstallPath $item
            if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
            Copy-Item $src $dst -Recurse -Force
        }
        Remove-Item $Tmp -Recurse -Force
    } else {
        Write-Host "git not found - downloading a source snapshot instead..." -ForegroundColor Cyan
        $Zip = Join-Path $env:TEMP "itda_update.zip"
        Invoke-WebRequest -Uri $RepoZipUrl -OutFile $Zip
        $Extract = Join-Path $env:TEMP "itda_update_extract"
        if (Test-Path $Extract) { Remove-Item $Extract -Recurse -Force }
        Expand-Archive -Path $Zip -DestinationPath $Extract -Force
        $SrcRoot = Get-ChildItem $Extract -Directory | Select-Object -First 1
        foreach ($item in $TrackedItems) {
            $src = Join-Path $SrcRoot.FullName $item
            if (-not (Test-Path $src)) { continue }
            $dst = Join-Path $InstallPath $item
            if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
            Copy-Item $src $dst -Recurse -Force
        }
        Remove-Item $Zip -Force
        Remove-Item $Extract -Recurse -Force
    }
}

Get-ChildItem $InstallPath -Recurse -Directory -Filter "__pycache__" -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

$PyExe = Join-Path $InstallPath "python_embeded\python.exe"
if (Test-Path $PyExe) {
    Write-Host "Refreshing Python dependencies (in case they changed)..." -ForegroundColor Cyan
    & $PyExe -m pip install --no-warn-script-location --quiet --upgrade aiohttp numpy opencv-python-headless fonttools
}

Write-Host ""
Write-Host "=== Update complete ===" -ForegroundColor Green
Write-Host ""

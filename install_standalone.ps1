#Requires -Version 5.1
<#
Installs a self-contained standalone copy of ITDA - its own Python embeddable
runtime, its own ffmpeg, and a desktop shortcut - so it runs independently of
ComfyUI. This script is meant to be launched via Install_ITDA_Standalone.bat,
which lives next to it in the ComfyUI-ITDA custom node folder.

Nothing here touches the ComfyUI installation this node is running inside of;
everything it downloads/builds goes into the install path the user chooses.
#>

$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/designloves2/itda.git"
$RepoZipUrl = "https://github.com/designloves2/itda/archive/refs/heads/main.zip"

Write-Host ""
Write-Host "=== ITDA Standalone Installer ===" -ForegroundColor Cyan
Write-Host "This copies ITDA out of ComfyUI's custom_nodes folder into its own"
Write-Host "self-contained install - its own Python, its own ffmpeg - so it can"
Write-Host "run on its own, without ComfyUI, as a local video editor."
Write-Host ""

$DefaultInstallPath = Join-Path $env:USERPROFILE "ITDA-Standalone"
$InstallPath = Read-Host "Install to [$DefaultInstallPath]"
if ([string]::IsNullOrWhiteSpace($InstallPath)) { $InstallPath = $DefaultInstallPath }
$InstallPath = $InstallPath.TrimEnd('\', '/')

if (Test-Path $InstallPath) {
    $existing = Get-ChildItem $InstallPath -ErrorAction SilentlyContinue
    if ($existing) {
        $answer = Read-Host "`"$InstallPath`" already exists and isn't empty. Continue and update it in place? (y/N)"
        if ($answer -notin @('y', 'Y')) { Write-Host "Cancelled."; exit 0 }
    }
}
New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null

# ---------------------------------------------------------------------------
# The install folder becomes an actual git checkout of the published repo
# (not a copy of whatever's locally sitting in custom_nodes) whenever git is
# available - that's what makes Update_ITDA_Standalone.bat later just a
# `git pull`, matching the intended custom-node-fix -> push -> standalone
# update workflow. Falls back to a one-shot zip snapshot when git isn't
# installed (update then re-downloads instead of incrementally pulling).
$GitAvailable = [bool](Get-Command git -ErrorAction SilentlyContinue)
$IsExistingGitCheckout = Test-Path (Join-Path $InstallPath ".git")
$InstallPathEmpty = -not (Get-ChildItem $InstallPath -ErrorAction SilentlyContinue)

Write-Host ""
if ($GitAvailable -and $IsExistingGitCheckout) {
    Write-Host "[1/6] Pulling latest ITDA source (git)..." -ForegroundColor Cyan
    Push-Location $InstallPath
    git pull --ff-only origin main
    Pop-Location
} elseif ($GitAvailable -and $InstallPathEmpty) {
    Write-Host "[1/6] Cloning ITDA source from GitHub..." -ForegroundColor Cyan
    git clone --branch main $RepoUrl $InstallPath
} else {
    if ($GitAvailable) {
        Write-Host "[1/6] Install folder has existing non-git content - downloading a source snapshot instead of cloning." -ForegroundColor Yellow
    } else {
        Write-Host "[1/6] git not found - downloading a source snapshot (later updates will re-download, not `git pull`)." -ForegroundColor Yellow
    }
    $RepoZip = Join-Path $env:TEMP "itda_source.zip"
    Invoke-WebRequest -Uri $RepoZipUrl -OutFile $RepoZip
    $Extract = Join-Path $env:TEMP "itda_source_extract"
    if (Test-Path $Extract) { Remove-Item $Extract -Recurse -Force }
    Expand-Archive -Path $RepoZip -DestinationPath $Extract -Force
    $SrcRoot = Get-ChildItem $Extract -Directory | Select-Object -First 1
    Copy-Item (Join-Path $SrcRoot.FullName "*") $InstallPath -Recurse -Force
    Remove-Item $RepoZip -Force
    Remove-Item $Extract -Recurse -Force
}
# Drop dev-only cruft that may have been sitting in the source tree.
Get-ChildItem $InstallPath -Recurse -Directory -Filter "__pycache__" -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
$PyDir = Join-Path $InstallPath "python_embeded"
$PyExe = Join-Path $PyDir "python.exe"
if (-not (Test-Path $PyExe)) {
    Write-Host "[2/6] Downloading Python 3.11 (embeddable)..." -ForegroundColor Cyan
    $PyZipUrl = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip"
    $PyZip = Join-Path $env:TEMP "itda_python_embed.zip"
    Invoke-WebRequest -Uri $PyZipUrl -OutFile $PyZip
    Expand-Archive -Path $PyZip -DestinationPath $PyDir -Force
    Remove-Item $PyZip -Force

    # Embeddable Python ships with site-packages import disabled (the ._pth
    # file's "import site" line is commented out) - without re-enabling it,
    # pip-installed packages are invisible to the interpreter.
    $PthFile = Get-ChildItem $PyDir -Filter "python*._pth" | Select-Object -First 1
    if ($PthFile) {
        (Get-Content $PthFile.FullName) -replace '^#\s*import site', 'import site' | Set-Content $PthFile.FullName
    }

    Write-Host "      Bootstrapping pip..."
    $GetPip = Join-Path $env:TEMP "itda_get-pip.py"
    Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $GetPip
    & $PyExe $GetPip --no-warn-script-location | Out-Null
    Remove-Item $GetPip -Force
} else {
    Write-Host "[2/6] Python embeddable already present, skipping." -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
Write-Host "[3/6] Installing Python dependencies (aiohttp, numpy, opencv, fonttools, librosa)..." -ForegroundColor Cyan
& $PyExe -m pip install --no-warn-script-location --quiet `
    aiohttp numpy opencv-python-headless fonttools librosa

# ---------------------------------------------------------------------------
$FfmpegDir = Join-Path $InstallPath "ffmpeg"
$FfmpegExe = Join-Path $FfmpegDir "ffmpeg.exe"
if (-not (Test-Path $FfmpegExe)) {
    Write-Host "[4/6] Downloading ffmpeg (BtbN static build)..." -ForegroundColor Cyan
    $FfmpegUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip"
    $FfmpegZip = Join-Path $env:TEMP "itda_ffmpeg.zip"
    Invoke-WebRequest -Uri $FfmpegUrl -OutFile $FfmpegZip
    $FfmpegExtract = Join-Path $env:TEMP "itda_ffmpeg_extract"
    if (Test-Path $FfmpegExtract) { Remove-Item $FfmpegExtract -Recurse -Force }
    Expand-Archive -Path $FfmpegZip -DestinationPath $FfmpegExtract -Force
    New-Item -ItemType Directory -Force -Path $FfmpegDir | Out-Null
    $BinDir = Get-ChildItem $FfmpegExtract -Recurse -Directory -Filter "bin" | Select-Object -First 1
    Copy-Item (Join-Path $BinDir.FullName "ffmpeg.exe") $FfmpegDir -Force
    Copy-Item (Join-Path $BinDir.FullName "ffprobe.exe") $FfmpegDir -Force
    Remove-Item $FfmpegZip -Force
    Remove-Item $FfmpegExtract -Recurse -Force
} else {
    Write-Host "[4/6] ffmpeg already present, skipping." -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
Write-Host "[5/6] Writing launcher..." -ForegroundColor Cyan
$RunBat = Join-Path $InstallPath "Run ITDA.bat"
@"
@echo off
cd /d "%~dp0"
set PATH=%~dp0ffmpeg;%PATH%
"%~dp0python_embeded\python.exe" "%~dp0itda_standalone.py"
pause
"@ | Set-Content -Path $RunBat -Encoding ASCII

# ---------------------------------------------------------------------------
Write-Host "[6/6] Creating desktop shortcut..." -ForegroundColor Cyan
try {
    $DesktopPath = [Environment]::GetFolderPath('Desktop')
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut((Join-Path $DesktopPath "ITDA.lnk"))
    $Shortcut.TargetPath = $RunBat
    $Shortcut.WorkingDirectory = $InstallPath
    $Shortcut.Description = "ITDA - Frame-Accurate AI Video Stitching (Standalone)"
    $Shortcut.Save()
    Write-Host "      Desktop shortcut created: ITDA.lnk"
} catch {
    Write-Host "      Couldn't create a desktop shortcut ($($_.Exception.Message)) - use `"$RunBat`" directly." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
Write-Host "Installed to: $InstallPath"
Write-Host "Launch it from the ITDA desktop shortcut, or by running:"
Write-Host "  `"$RunBat`""
Write-Host ""

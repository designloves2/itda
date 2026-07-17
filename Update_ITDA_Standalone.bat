@echo off
rem Keep this file a trivial, never-changing stub. cmd.exe reads a .bat
rem line-by-line as it runs, so if update_standalone.ps1 ever overwrote THIS
rem file mid-run, the next line read here would be corrupted - that's why
rem update_standalone.ps1 deliberately excludes both launcher files from
rem what it updates. All real logic belongs in the .ps1, not here.
title ITDA Standalone Updater
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update_standalone.ps1"
pause

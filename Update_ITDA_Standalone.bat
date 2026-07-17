@echo off
title ITDA Standalone Updater
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update_standalone.ps1"
pause

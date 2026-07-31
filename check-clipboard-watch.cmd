@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0check-clipboard-watch.ps1"
pause

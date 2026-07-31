@echo off
set SCRIPT_DIR=%~dp0
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%SCRIPT_DIR%install-and-start.ps1"
pause

@echo off
set SCRIPT_DIR=%~dp0
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$pidFile = Join-Path '%SCRIPT_DIR%' 'clipboard-watch.pid'; if (Test-Path $pidFile) { $watchPid = Get-Content $pidFile -ErrorAction SilentlyContinue; if ($watchPid) { Stop-Process -Id $watchPid -Force -ErrorAction SilentlyContinue }; Remove-Item $pidFile -Force -ErrorAction SilentlyContinue }; Write-Host 'Work Clipboard watcher stopped if it was running.'"

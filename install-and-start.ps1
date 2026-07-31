$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Startup = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $Startup "Work Clipboard Watcher.lnk"
$HiddenLauncher = Join-Path $Root "start-clipboard-watch-hidden.vbs"

function Test-CompanionRunning {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:18765/" -UseBasicParsing -TimeoutSec 1
    return $response.StatusCode -eq 200
  }
  catch {
    return $false
  }
}

if (-not (Test-Path $HiddenLauncher)) {
  throw "Missing launcher: $HiddenLauncher"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = "`"$HiddenLauncher`""
$shortcut.WorkingDirectory = $Root
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,167"
$shortcut.Description = "Start Work Clipboard companion"
$shortcut.Save()

if (-not (Test-CompanionRunning)) {
  $shell.Run("wscript.exe `"$HiddenLauncher`"", 0, $false) | Out-Null
  Start-Sleep -Milliseconds 800
}

Write-Host ""
Write-Host "工作剪贴板已简化为自动启动模式。"
Write-Host ""
Write-Host "以后使用："
Write-Host "1. 正常打开 Chrome 新标签页。"
Write-Host "2. 在任意软件 Ctrl+C 复制，或 Win+Shift+S 截图。"
Write-Host "3. 内容会自动进入新标签页剪贴板。"
Write-Host ""
Write-Host "如果还没有加载 Chrome 扩展，请打开 chrome://extensions 后加载此文件夹："
Write-Host $Root
Write-Host ""

Start-Process "chrome.exe" "chrome://extensions"

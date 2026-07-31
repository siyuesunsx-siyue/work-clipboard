Add-Type -AssemblyName System.Windows.Forms

$connected = $false
try {
  $response = Invoke-WebRequest -Uri "http://127.0.0.1:18765/" -UseBasicParsing -TimeoutSec 2
  $connected = $response.StatusCode -eq 200
}
catch {
  $connected = $false
}

Write-Host ""
Write-Host "Work Clipboard 检查结果"
Write-Host "------------------------"

if ($connected) {
  Write-Host "本地监听：已连接"
}
else {
  Write-Host "本地监听：未连接"
  Write-Host "处理方式：双击 install-and-start 或 open-work-clipboard 启动。"
}

try {
  if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
    Write-Host "当前系统剪贴板：包含图片"
  }
  elseif ([System.Windows.Forms.Clipboard]::ContainsText()) {
    Write-Host "当前系统剪贴板：包含文本"
  }
  elseif ([System.Windows.Forms.Clipboard]::ContainsFileDropList()) {
    Write-Host "当前系统剪贴板：包含文件路径"
  }
  else {
    Write-Host "当前系统剪贴板：没有可识别的文本、图片或文件路径"
  }
}
catch {
  Write-Host "当前系统剪贴板：读取失败，可能正被其他软件占用。"
}

Write-Host ""
Write-Host "截图测试：按 Win+Shift+S，框选区域后松开鼠标；再运行这个检查。"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Web.Extensions
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class ForegroundWindow {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

$ErrorActionPreference = "Continue"
$Port = 18765
$PidPath = Join-Path $PSScriptRoot "clipboard-watch.pid"
$LogPath = Join-Path $PSScriptRoot "clipboard-watch.log"
$Items = New-Object System.Collections.ArrayList
$Seen = @{}
$Serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$Serializer.MaxJsonLength = 104857600

function Write-Log([string]$Message) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
}

function Get-Sha256([byte[]]$Bytes) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    return [System.BitConverter]::ToString($sha.ComputeHash($Bytes)).Replace("-", "").ToLowerInvariant()
  }
  finally {
    $sha.Dispose()
  }
}

function Get-Sha256Text([string]$Text) {
  return Get-Sha256 ([System.Text.Encoding]::UTF8.GetBytes($Text))
}

function Add-ClipboardItem($Item, [string]$Signature) {
  if ($Seen.ContainsKey($Signature)) {
    return
  }

  $Seen[$Signature] = $true
  [void]$Items.Insert(0, $Item)

  while ($Items.Count -gt 200) {
    $Items.RemoveAt($Items.Count - 1)
  }
}

function First-TextLine([string]$Text, [string]$Fallback) {
  $line = $Text -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1
  if ([string]::IsNullOrWhiteSpace($line)) {
    return $Fallback
  }

  return [string]$line
}

function Get-SourceContext {
  try {
    $handle = [ForegroundWindow]::GetForegroundWindow()
    $builder = New-Object System.Text.StringBuilder 512
    [void][ForegroundWindow]::GetWindowText($handle, $builder, $builder.Capacity)
    [uint32]$processId = 0
    [void][ForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processId)
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue

    return @{
      sourceApp = if ($process) { [string]$process.ProcessName } else { "" }
      sourceWindow = [string]$builder.ToString()
    }
  }
  catch {
    return @{
      sourceApp = ""
      sourceWindow = ""
    }
  }
}

function Capture-Text {
  if (-not [System.Windows.Forms.Clipboard]::ContainsText()) {
    return
  }

  $text = [System.Windows.Forms.Clipboard]::GetText()
  if ([string]::IsNullOrWhiteSpace($text)) {
    return
  }

  $hash = Get-Sha256Text $text
  $source = Get-SourceContext
  Add-ClipboardItem @{
    id = "win-text-$hash"
    type = "text"
    title = (First-TextLine $text "复制的文本")
    text = [string]$text
    sourceApp = $source.sourceApp
    sourceWindow = $source.sourceWindow
    createdAt = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    tags = @("系统剪贴板", "Ctrl+C")
  } "text:$hash"
}

function Capture-Image {
  if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) {
    return
  }

  $image = [System.Windows.Forms.Clipboard]::GetImage()
  if ($null -eq $image) {
    return
  }

  $stream = New-Object System.IO.MemoryStream
  try {
    $image.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $stream.ToArray()
    $hash = Get-Sha256 $bytes
    $now = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    $source = Get-SourceContext

    Add-ClipboardItem @{
      id = "win-image-$hash"
      type = "image"
      title = "屏幕截图"
      mime = "image/png"
      fileName = "screenshot-$now.png"
      size = $bytes.Length
      base64 = [Convert]::ToBase64String($bytes)
      sourceApp = $source.sourceApp
      sourceWindow = $source.sourceWindow
      createdAt = $now
      tags = @("系统剪贴板", "截图")
    } "image:$hash"
  }
  finally {
    $stream.Dispose()
    $image.Dispose()
  }
}

function Capture-Files {
  if (-not [System.Windows.Forms.Clipboard]::ContainsFileDropList()) {
    return
  }

  $paths = @([System.Windows.Forms.Clipboard]::GetFileDropList())
  if ($paths.Count -eq 0) {
    return
  }

  $text = ($paths -join "`r`n")
  $hash = Get-Sha256Text $text
  $source = Get-SourceContext

  Add-ClipboardItem @{
    id = "win-files-$hash"
    type = "text"
    title = "复制的文件路径"
    text = [string]$text
    sourceApp = $source.sourceApp
    sourceWindow = $source.sourceWindow
    createdAt = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    tags = @("系统剪贴板", "文件路径")
  } "files:$hash"
}

function Capture-Clipboard {
  try {
    Capture-Image
    Capture-Files
    Capture-Text
  }
  catch {
    Write-Log "Clipboard read failed: $($_.Exception.Message)"
  }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 700
$timer.Add_Tick({ Capture-Clipboard })
$timer.Start()

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $Port)
$listener.Start()
Set-Content -Path $PidPath -Value $PID -Encoding ASCII

Write-Host "Work Clipboard companion is running at http://127.0.0.1:$Port/"
Write-Host "Keep this window open while you want global Ctrl+C and Win+Shift+S capture."
Write-Log "Started on port $Port with PID $PID"

function Write-JsonResponse($Stream, $Value) {
  $cleanItems = @()

  foreach ($item in @($Items)) {
    $cleanItems += @{
      id = [string]$item["id"]
      type = [string]$item["type"]
      title = [string]$item["title"]
      text = if ($null -ne $item["text"]) { [string]$item["text"] } else { $null }
      mime = if ($null -ne $item["mime"]) { [string]$item["mime"] } else { $null }
      fileName = if ($null -ne $item["fileName"]) { [string]$item["fileName"] } else { $null }
      size = if ($null -ne $item["size"]) { [int64]$item["size"] } else { $null }
      base64 = if ($null -ne $item["base64"]) { [string]$item["base64"] } else { $null }
      sourceApp = if ($null -ne $item["sourceApp"]) { [string]$item["sourceApp"] } else { "" }
      sourceWindow = if ($null -ne $item["sourceWindow"]) { [string]$item["sourceWindow"] } else { "" }
      createdAt = [int64]$item["createdAt"]
      tags = @($item["tags"] | ForEach-Object { [string]$_ })
    }
  }

  $Value = @{
    ok = $true
    items = $cleanItems
  }

  $json = $Serializer.Serialize($Value)
  $body = [System.Text.Encoding]::UTF8.GetBytes($json)
  $headerText = @(
    "HTTP/1.1 200 OK",
    "Content-Type: application/json; charset=utf-8",
    "Access-Control-Allow-Origin: *",
    "Access-Control-Allow-Headers: Content-Type",
    "Cache-Control: no-store",
    "Content-Length: $($body.Length)",
    "Connection: close",
    "",
    ""
  ) -join "`r`n"

  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerText)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  $Stream.Write($body, 0, $body.Length)
  $Stream.Flush()
}

function Write-OptionsResponse($Stream) {
  $headerText = @(
    "HTTP/1.1 204 No Content",
    "Access-Control-Allow-Origin: *",
    "Access-Control-Allow-Headers: Content-Type",
    "Connection: close",
    "",
    ""
  ) -join "`r`n"

  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerText)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  $Stream.Flush()
}

function Handle-Client($Client) {
  try {
    $stream = $Client.GetStream()
    $buffer = New-Object byte[] 1024
    $read = $stream.Read($buffer, 0, $buffer.Length)
    $request = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read)

    if ([string]::IsNullOrWhiteSpace($request)) {
      return
    }

    if ($request.StartsWith("OPTIONS ")) {
      Write-OptionsResponse $stream
    }
    else {
      Write-JsonResponse $stream @{
        ok = $true
        items = @($Items)
      }
    }
  }
  catch {
    Write-Log "HTTP failed: $($_.Exception.ToString())"
  }
  finally {
    $Client.Close()
  }
}

$lastCapture = [DateTime]::UtcNow.AddSeconds(-1)

while ($true) {
  [System.Windows.Forms.Application]::DoEvents()

  if (([DateTime]::UtcNow - $lastCapture).TotalMilliseconds -ge 700) {
    Capture-Clipboard
    $lastCapture = [DateTime]::UtcNow
  }

  while ($listener.Pending()) {
    $client = $listener.AcceptTcpClient()
    Handle-Client $client
  }

  Start-Sleep -Milliseconds 50
}

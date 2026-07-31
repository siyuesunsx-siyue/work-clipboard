$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dist = Join-Path $Root "dist"
$ZipPath = Join-Path $Dist "work-clipboard.zip"
$Temp = Join-Path $Dist "work-clipboard"

if (Test-Path $Temp) {
  Remove-Item $Temp -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $Temp | Out-Null

$include = @(
  "manifest.json",
  "background.js",
  "content-script.js",
  "newtab.html",
  "newtab.js",
  "styles.css",
  "clipboard-watch.ps1",
  "install-and-start.cmd",
  "install-and-start.ps1",
  "start-clipboard-watch.cmd",
  "start-clipboard-watch-hidden.vbs",
  "open-work-clipboard.cmd",
  "stop-clipboard-watch.cmd",
  "check-clipboard-watch.cmd",
  "check-clipboard-watch.ps1",
  "README.md",
  "PRIVACY.md",
  "LICENSE"
)

foreach ($file in $include) {
  Copy-Item -Path (Join-Path $Root $file) -Destination $Temp -Force
}

Copy-Item -Path (Join-Path $Root "icons") -Destination (Join-Path $Temp "icons") -Recurse -Force

if (Test-Path $ZipPath) {
  Remove-Item $ZipPath -Force
}

Compress-Archive -Path (Join-Path $Temp "*") -DestinationPath $ZipPath

Write-Host "Packaged:"
Write-Host $ZipPath

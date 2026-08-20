# Build NEXUS Mobile locally: APK (Android) + Windows exe
# Usage, from the repo root in PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\mobile\build.ps1
# or just "both": .\mobile\build.ps1 both  |  apk  |  win
param([string]$Target = "both")

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $PSScriptRoot

function Flutter($args) {
  Write-Host "`n>>> flutter $args" -ForegroundColor Cyan
  & flutter $args
  if ($LASTEXITCODE -ne 0) { throw "flutter $args failed ($LASTEXITCODE)" }
}

Write-Host "== flutter doctor (check) ==" -ForegroundColor Yellow
& flutter doctor
if ($LASTEXITCODE -ne 0) { Write-Host "doctor reported issues, continuing anyway..." -ForegroundColor DarkYellow }

Flutter @("pub", "get")

if ($Target -eq "apk" -or $Target -eq "both") {
  Flutter @("build", "apk", "--release")
  Write-Host "`nAPK готов:" -ForegroundColor Green
  Write-Host "  mobile\build\app\outputs\flutter-apk\app-release.apk"
}

if ($Target -eq "win" -or $Target -eq "both") {
  # Подключить сборку под десктоп, если выключена
  try { & flutter config --enable-windows-desktop | Out-Null } catch {}
  # Сгенерировать папку windows/ если её нет (она не в git)
  if (-not (Test-Path ".\windows")) {
    Write-Host "`n== Генерирую Windows-скелет (flutter create) ==" -ForegroundColor Yellow
    Flutter @("create", "--platforms=windows", "--project-name", "nexus_mobile", ".")
  }
  # Окно размером с телефон, чтобы мобильный UI не растягивался
  $mainCpp = ".\windows\runner\main.cpp"
  if (Test-Path $mainCpp) {
    (Get-Content $mainCpp -Raw) `
      -replace 'Win32Window::Size size\(1280, 720\);', 'Win32Window::Size size(432, 900);' |
      Set-Content $mainCpp -NoNewline
  }
  Flutter @("build", "windows", "--release")
  Write-Host "`nWindows-сборка готова:" -ForegroundColor Green
  Write-Host "  mobile\build\windows\x64\runner\Release\nexus_mobile.exe"
}

Write-Host "`nГотово!" -ForegroundColor Green

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  throw "需要 .NET 8 SDK 才能构建 Windows 系统音频 helper"
}

$Out = Join-Path $Root "build/win-audio"
$Target = Join-Path $Root "assets/system-audio/win32-x64"
New-Item -ItemType Directory -Force -Path $Out | Out-Null
New-Item -ItemType Directory -Force -Path $Target | Out-Null

dotnet publish "src/win-audio/DshInterpret.AudioCapture.csproj" -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -o $Out

$Exe = Join-Path $Out "dsh-asr-capture-system.exe"
if (-not (Test-Path $Exe)) {
  throw "Windows helper 未生成: $Exe"
}
Copy-Item $Exe (Join-Path $Target "dsh-asr-capture-system.exe") -Force
Write-Host "Windows helper ready: $Target"

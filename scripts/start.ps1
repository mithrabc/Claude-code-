<#
.SYNOPSIS
  Launch Claude Remote on Windows and print the URL to open on your phone.

.DESCRIPTION
  - Installs npm dependencies on first run.
  - Generates a random AUTH_TOKEN (once) and saves it to .env so the link is stable.
  - Detects your LAN IPv4 address and prints the exact phone URL (with the token).
  - Starts the server.

.PARAMETER Workspace
  Directory Claude Code should operate in (the project you want to work on).
  Defaults to the value in .env, or the current directory.

.PARAMETER Port
  Port to listen on. Default 4517.

.EXAMPLE
  ./scripts/start.ps1 -Workspace C:\dev\my-project
#>

[CmdletBinding()]
param(
  [string]$Workspace,
  [int]$Port = 4517
)

$ErrorActionPreference = "Stop"

# Resolve project root (parent of this script's folder) and work from there.
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# --- Prerequisites ---------------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "Node.js is not installed or not on PATH. Install Node 20+ from https://nodejs.org and re-run."
}
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Host "WARNING: 'claude' CLI not found on PATH. The app will only work in MOCK mode until it is installed." -ForegroundColor Yellow
}

# --- Dependencies ----------------------------------------------------------
if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
  Write-Host "Installing dependencies..." -ForegroundColor Cyan
  npm install
  if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }
}

# --- .env: load existing values, generate a token once ---------------------
$EnvPath = Join-Path $ProjectRoot ".env"
$envMap = [ordered]@{}
if (Test-Path $EnvPath) {
  foreach ($line in Get-Content $EnvPath) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith("#")) { continue }
    $i = $t.IndexOf("=")
    if ($i -lt 1) { continue }
    $envMap[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim()
  }
}

$token = $envMap["AUTH_TOKEN"]
if ([string]::IsNullOrWhiteSpace($token)) {
  $bytes = New-Object 'System.Byte[]' 18
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLower()
  $envMap["AUTH_TOKEN"] = $token
  Write-Host "Generated a new AUTH_TOKEN and saved it to .env" -ForegroundColor Green
}

if ($Workspace) { $envMap["WORKSPACE"] = (Resolve-Path $Workspace).Path }
$envMap["PORT"] = "$Port"

# Persist .env (keep it readable).
$out = $envMap.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }
Set-Content -Path $EnvPath -Value $out -Encoding UTF8

# --- Find LAN IPv4 ---------------------------------------------------------
$ip = $null
try {
  $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
    Where-Object { $_.IPAddress -notlike "169.254.*" -and $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -ne "WellKnown" } |
    Sort-Object -Property @{ Expression = { $_.InterfaceAlias -match "Wi-Fi|Ethernet" } } -Descending |
    Select-Object -First 1 -ExpandProperty IPAddress)
} catch {}
if (-not $ip) { $ip = "<your-LAN-IP>" }

$ws = if ($envMap["WORKSPACE"]) { $envMap["WORKSPACE"] } else { $ProjectRoot }

Write-Host ""
Write-Host "======================================================" -ForegroundColor DarkGray
Write-Host " Claude Remote is starting" -ForegroundColor White
Write-Host "   Workspace : $ws"
Write-Host "   On this PC: http://localhost:$Port/?token=$token"
Write-Host "   On phone  : http://$ip`:$Port/?token=$token" -ForegroundColor Green
Write-Host ""
Write-Host " Phone must be on the SAME Wi-Fi network as this PC." -ForegroundColor Yellow
Write-Host " If it won't load, allow Node.js through Windows Firewall" -ForegroundColor Yellow
Write-Host " (Private networks) — see README 'Windows firewall'." -ForegroundColor Yellow
Write-Host "======================================================" -ForegroundColor DarkGray
Write-Host ""

# --- Launch (config.js reads .env, so no need to pass env here) -------------
node (Join-Path $ProjectRoot "src\server.js")

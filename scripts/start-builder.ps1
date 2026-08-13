param(
  [int]$Port = 3107,
  [switch]$NoOpen,
  [switch]$ReplaceExisting,
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$computer2McpUrl = if ($env:COMPUTER2_MCP_URL) { $env:COMPUTER2_MCP_URL } elseif ($env:MCP_MAIN_NODE_URL) { $env:MCP_MAIN_NODE_URL } else { 'http://127.0.0.1:3000/mcp' }
if ($env:BUILDER_PORT -and [int]::TryParse($env:BUILDER_PORT, [ref]$Port)) { }
if ($Port -eq 3000) { throw 'Port 3000 is reserved for Computer 2 MCP. Choose a dedicated Builder port.' }

if ($ValidateOnly) {
  [pscustomobject]@{ port = $Port; computer2Url = $computer2McpUrl; supervised = $true; projectRoot = $projectRoot } | ConvertTo-Json -Compress
  exit 0
}

function Test-BuilderHealth {
  param([int]$TargetPort)
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$TargetPort/api/health" -TimeoutSec 3
    return $response.architecture -eq 'hybrid-docker-mcp'
  } catch { return $false }
}

function Import-SelectedEnvironment {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $allowed = @(
    'MCP_AUTH_TOKEN','MCP_MAIN_NODE_URL','COMPUTER2_MCP_URL','COMPUTER2_HEALTH_URL',
    'DOCKER_MCP_GATEWAY_TOKEN','DOCKER_MCP_GATEWAY_URL','DOCKER_MCP_GATEWAY_HEALTH_URL',
    'MCP_GATEWAY_AUTH_TOKEN','WINDMILL_URL','BUILDER_PROJECTS_ROOT','BUILDER_STATE_DB'
  )
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { continue }
    $name = $matches[1]
    if ($allowed -notcontains $name -or (Get-Item "Env:$name" -ErrorAction SilentlyContinue)) { continue }
    $value = $matches[2].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) { $value = $value.Substring(1, $value.Length - 2) }
    Set-Item -Path "Env:$name" -Value $value
  }
}

$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
  if ((Test-BuilderHealth -TargetPort $Port) -and -not $ReplaceExisting) {
    if (-not $NoOpen) { Start-Process "http://127.0.0.1:$Port" }
    Write-Output "Autonomous Builder is already running at http://127.0.0.1:$Port"
    exit 0
  }
  if (-not $ReplaceExisting) { throw "Port $Port is already owned by process $($existing.OwningProcess)." }
  Stop-Process -Id $existing.OwningProcess -Force
  Start-Sleep -Seconds 2
}

$computer2Root = $env:COMPUTER2_HOME
if (-not $computer2Root) {
  try { $computer2Root = (Invoke-RestMethod -Uri 'http://127.0.0.1:3000/health/deep' -TimeoutSec 5).baseDirectory } catch { }
}
if ($computer2Root) {
  Import-SelectedEnvironment -Path (Join-Path $computer2Root '.env.local')
  Import-SelectedEnvironment -Path (Join-Path $computer2Root '.env.mcp')
}

$env:COMPUTER2_MCP_URL = if ($env:COMPUTER2_MCP_URL) { $env:COMPUTER2_MCP_URL } else { $computer2McpUrl }
if (-not $env:BUILDER_SERVICE_TOKEN -and $env:MCP_AUTH_TOKEN) { $env:BUILDER_SERVICE_TOKEN = $env:MCP_AUTH_TOKEN }
if (-not $env:BUILDER_SERVICE_TOKEN) { throw 'Computer 2 MCP authentication is unavailable to the local launcher.' }
$env:BUILDER_PORT = "$Port"

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) { & npm.cmd ci --prefix $projectRoot; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' } }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.next\BUILD_ID'))) { & npm.cmd run build --prefix $projectRoot; if ($LASTEXITCODE -ne 0) { throw 'Production build failed' } }

$runtimeDirectory = Join-Path $projectRoot '.builder\runtime'
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
$supervisor = Join-Path $PSScriptRoot 'builder-supervisor.ps1'
$process = Start-Process powershell -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$supervisor,'-ProjectRoot',$projectRoot,'-Port',"$Port") -WindowStyle Hidden -PassThru
$process.Id | Set-Content -LiteralPath (Join-Path $runtimeDirectory 'supervisor.pid')

$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  if (Test-BuilderHealth -TargetPort $Port) { $ready = $true; break }
  Start-Sleep -Seconds 1
}
if (-not $ready) { throw 'Builder supervisor started, but the local health endpoint did not become ready.' }
if (-not $NoOpen) { Start-Process "http://127.0.0.1:$Port" }
Write-Output "Autonomous Builder started at http://127.0.0.1:$Port"

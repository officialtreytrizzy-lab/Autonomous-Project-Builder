param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [int]$Port = 3107
)

$ErrorActionPreference = 'Continue'
$runtimeDirectory = Join-Path $ProjectRoot '.builder\runtime'
$logDirectory = Join-Path $ProjectRoot '.builder\logs'
$standaloneRoot = Join-Path $ProjectRoot '.next_build\standalone'
$standaloneServer = Join-Path $standaloneRoot 'server.js'
$staticSource = Join-Path $ProjectRoot '.next_build\static'
$staticDestination = Join-Path $standaloneRoot '.next_build\static'
$legacyStaticDestination = Join-Path $standaloneRoot '.next\static'
$publicSource = Join-Path $ProjectRoot 'public'
$publicDestination = Join-Path $standaloneRoot 'public'
New-Item -ItemType Directory -Path $runtimeDirectory,$logDirectory -Force | Out-Null
if (-not $env:BUILDER_STATE_DB) { $env:BUILDER_STATE_DB = Join-Path $ProjectRoot '.builder\state.db' }
if (-not $env:BUILDER_PROJECTS_ROOT) { $env:BUILDER_PROJECTS_ROOT = $HOME }
$env:BUILDER_PORT = "$Port"
$env:PORT = "$Port"
$env:HOSTNAME = '127.0.0.1'

if (-not (Test-Path -LiteralPath $standaloneServer)) { throw "Standalone Builder server is missing: $standaloneServer" }
if (Test-Path -LiteralPath $legacyStaticDestination) { Remove-Item -LiteralPath $legacyStaticDestination -Recurse -Force }
if (Test-Path -LiteralPath $staticSource) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $staticDestination) -Force | Out-Null
  if (Test-Path -LiteralPath $staticDestination) { Remove-Item -LiteralPath $staticDestination -Recurse -Force }
  Copy-Item -LiteralPath $staticSource -Destination $staticDestination -Recurse -Force
}
if (Test-Path -LiteralPath $publicSource) {
  if (Test-Path -LiteralPath $publicDestination) { Remove-Item -LiteralPath $publicDestination -Recurse -Force }
  Copy-Item -LiteralPath $publicSource -Destination $publicDestination -Recurse -Force
}

$createdNew = $false
$mutex = [System.Threading.Mutex]::new($true, "Local\AutonomousBuilderSupervisor-$Port", [ref]$createdNew)
if (-not $createdNew) { exit 0 }
try {
  while ($true) {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) { Start-Sleep -Seconds 5; continue }
    $stdout = Join-Path $logDirectory 'builder.stdout.log'
    $stderr = Join-Path $logDirectory 'builder.stderr.log'
    $child = Start-Process node.exe -ArgumentList @('server.js') -WorkingDirectory $standaloneRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $child.Id | Set-Content -LiteralPath (Join-Path $runtimeDirectory 'builder.pid')
    Wait-Process -Id $child.Id
    Add-Content -LiteralPath (Join-Path $logDirectory 'supervisor.log') -Value "$(Get-Date -Format o) standalone builder process $($child.Id) exited; restarting"
    Start-Sleep -Seconds 3
  }
} finally {
  if ($createdNew) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}

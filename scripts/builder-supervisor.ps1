param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [int]$Port = 3107
)

$ErrorActionPreference = 'Continue'
$runtimeDirectory = Join-Path $ProjectRoot '.builder\runtime'
$logDirectory = Join-Path $ProjectRoot '.builder\logs'
New-Item -ItemType Directory -Path $runtimeDirectory,$logDirectory -Force | Out-Null
$env:BUILDER_PORT = "$Port"

while ($true) {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) { Start-Sleep -Seconds 5; continue }
  $stdout = Join-Path $logDirectory 'builder.stdout.log'
  $stderr = Join-Path $logDirectory 'builder.stderr.log'
  $child = Start-Process npm.cmd -ArgumentList @('run','start','--','-p',"$Port") -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  $child.Id | Set-Content -LiteralPath (Join-Path $runtimeDirectory 'builder.pid')
  Wait-Process -Id $child.Id
  Add-Content -LiteralPath (Join-Path $logDirectory 'supervisor.log') -Value "$(Get-Date -Format o) builder process $($child.Id) exited; restarting"
  Start-Sleep -Seconds 3
}

param(
  [string]$OutputDirectory,
  [switch]$ValidateOnly,
  [switch]$Silent
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'dist-desktop' }
$resolvedOutput = (Resolve-Path -LiteralPath $OutputDirectory).Path
$normalizedOutput = [IO.Path]::GetFullPath($resolvedOutput).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$installers = @(Get-ChildItem -LiteralPath $resolvedOutput -File -Filter 'Autonomous-Project-Builder-Setup-*.exe')
if ($installers.Count -ne 1) {
  throw "Expected exactly one Autonomous Project Builder Setup executable in $resolvedOutput; found $($installers.Count)."
}
$installerPath = [IO.Path]::GetFullPath($installers[0].FullName)
if (-not $installerPath.StartsWith($normalizedOutput, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Resolved installer path is outside the requested desktop output directory.'
}
if ($ValidateOnly) {
  Write-Output $installerPath
  exit 0
}
$arguments = if ($Silent) { @('/S') } else { @() }
$installer = Start-Process -FilePath $installerPath -ArgumentList $arguments -Wait -PassThru
if ($installer.ExitCode -ne 0) { throw "Desktop installer exited with code $($installer.ExitCode)." }
Write-Output "Autonomous Project Builder installed from $installerPath"


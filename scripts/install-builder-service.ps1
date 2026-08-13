param([int]$Port = 3107)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'start-builder.ps1'
$taskName = 'Autonomous Project Builder'
$argument = "-NoProfile -ExecutionPolicy Bypass -File `"$launcher`" -Port $Port -NoOpen"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Starts and supervises the private Autonomous Project Builder on Computer 2.' -Force | Out-Null
Write-Output "Installed '$taskName' for http://127.0.0.1:$Port"

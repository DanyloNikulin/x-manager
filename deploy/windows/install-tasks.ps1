[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$WebPort = 3999,
    [ValidateRange(30, 3600)]
    [int]$WorkerIntervalSeconds = 300,
    [switch]$Start
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$webScript = Join-Path $PSScriptRoot 'start-web.ps1'
$workerScript = Join-Path $PSScriptRoot 'run-worker-loop.ps1'
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Highest
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable

$webArguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$webScript`" -Port $WebPort"
$workerArguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$workerScript`" -IntervalSeconds $WorkerIntervalSeconds"
$webAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $webArguments -WorkingDirectory $repoRoot
$workerAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $workerArguments -WorkingDirectory $repoRoot

Register-ScheduledTask -TaskName 'XManager-Web' -Action $webAction -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Register-ScheduledTask -TaskName 'XManager-Worker' -Action $workerAction -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

if ($Start) {
    Start-ScheduledTask -TaskName 'XManager-Web'
    Start-ScheduledTask -TaskName 'XManager-Worker'
}

Get-ScheduledTask -TaskName 'XManager-Web', 'XManager-Worker' |
    Select-Object TaskName, State

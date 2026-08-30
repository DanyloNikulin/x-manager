[CmdletBinding()]
param(
    [ValidateRange(30, 3600)]
    [int]$IntervalSeconds = 300
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envPath = Join-Path $repoRoot '.env.production.local'
$binary = Join-Path $repoRoot 'bin\x-manager-orchestrator.exe'
$config = Join-Path $repoRoot 'orchestrator\config.toml'
$logDirectory = Join-Path $repoRoot 'logs'
$logPath = Join-Path $logDirectory 'worker.log'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-Log([string]$Message) {
    [System.IO.File]::AppendAllText($logPath, "$Message`r`n", $utf8)
}

function Rotate-Log {
    if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 10MB) {
        Move-Item -LiteralPath $logPath -Destination "$logPath.1" -Force
    }
}

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
foreach ($requiredPath in @($envPath, $binary, $config)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required worker file is missing: $requiredPath"
    }
}

$tokenLine = [System.IO.File]::ReadAllLines($envPath) |
    Where-Object { $_ -match '^\s*X_MANAGER_ADMIN_TOKEN\s*=' } |
    Select-Object -First 1
if (-not $tokenLine) {
    throw 'X_MANAGER_ADMIN_TOKEN is missing from .env.production.local.'
}

$token = $tokenLine.Substring($tokenLine.IndexOf('=') + 1).Trim()
if ($token.Length -ge 2 -and (($token.StartsWith('"') -and $token.EndsWith('"')) -or ($token.StartsWith("'") -and $token.EndsWith("'")))) {
    $token = $token.Substring(1, $token.Length - 2)
}
if ([string]::IsNullOrWhiteSpace($token)) {
    throw 'X_MANAGER_ADMIN_TOKEN is empty in .env.production.local.'
}

$env:X_MANAGER_ADMIN_TOKEN = $token
$env:RUST_LOG = 'info'
Set-Location -LiteralPath $repoRoot

Get-Process -Name 'x-manager-orchestrator' -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $binary } |
    Stop-Process -Force
Rotate-Log

while ($true) {
    Write-Log "[$(Get-Date -Format o)] starting subscription worker pass"
    try {
        $ErrorActionPreference = 'Continue'
        & $binary --config $config run-once 2>&1 | ForEach-Object { Write-Log $_.ToString() }
        $exitCode = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'
        Write-Log "[$(Get-Date -Format o)] worker exit code: $exitCode"
    }
    catch {
        $ErrorActionPreference = 'Stop'
        Write-Log "[$(Get-Date -Format o)] worker launcher error: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds $IntervalSeconds
}

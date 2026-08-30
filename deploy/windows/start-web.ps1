[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3999
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logDirectory = Join-Path $repoRoot 'logs'
$logPath = Join-Path $logDirectory 'web.log'
$envPath = Join-Path $repoRoot '.env.production.local'
$standaloneRoot = Join-Path $repoRoot '.next\standalone'
$server = Join-Path $standaloneRoot 'server.js'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-Log([string]$Message) {
    [System.IO.File]::AppendAllText($logPath, "$Message`r`n", $utf8)
}

function Rotate-Log {
    if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 10MB) {
        Move-Item -LiteralPath $logPath -Destination "$logPath.1" -Force
    }
}

function Import-DotEnv([string]$Path) {
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $separator = $trimmed.IndexOf('=')
        if ($separator -le 0) { continue }
        $name = $trimmed.Substring(0, $separator).Trim()
        $value = $trimmed.Substring($separator + 1).Trim()
        if ($name -notmatch '^[A-Z][A-Z0-9_]*$') { continue }
        if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        [System.Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
}

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
foreach ($requiredPath in @($envPath, $server)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required web file is missing: $requiredPath"
    }
}

$listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($listener) {
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    if ($existing.Name -ne 'node.exe' -or $existing.CommandLine -notlike "*$repoRoot*") {
        throw "Port $Port is already owned by an unrelated process ($($existing.ProcessId), $($existing.Name))."
    }
    Stop-Process -Id $existing.ProcessId -Force
    Start-Sleep -Seconds 1
}

Set-Location -LiteralPath $repoRoot
Import-DotEnv $envPath
$env:NODE_ENV = 'production'
$env:HOSTNAME = '127.0.0.1'
$env:PORT = $Port.ToString()

$staticSource = Join-Path $repoRoot '.next\static'
$staticTarget = Join-Path $standaloneRoot '.next\static'
if (Test-Path -LiteralPath $staticSource) {
    New-Item -ItemType Directory -Path $staticTarget -Force | Out-Null
    Get-ChildItem -LiteralPath $staticSource -Force | Copy-Item -Destination $staticTarget -Recurse -Force
}
$publicSource = Join-Path $repoRoot 'public'
$publicTarget = Join-Path $standaloneRoot 'public'
if (Test-Path -LiteralPath $publicSource) {
    New-Item -ItemType Directory -Path $publicTarget -Force | Out-Null
    Get-ChildItem -LiteralPath $publicSource -Force | Copy-Item -Destination $publicTarget -Recurse -Force
}

Rotate-Log
Write-Log "[$(Get-Date -Format o)] starting X-Manager on 127.0.0.1:$Port"

$ErrorActionPreference = 'Continue'
& $node $server 2>&1 | ForEach-Object { Write-Log $_.ToString() }
$exitCode = $LASTEXITCODE
Write-Log "[$(Get-Date -Format o)] web exit code: $exitCode"
exit $exitCode

$ErrorActionPreference = 'Stop'
$envFile = 'D:\Services\x-manager\.env.production.local'
$lines = Get-Content -LiteralPath $envFile
$map = @{}
foreach ($line in $lines) {
  $t = $line.Trim()
  if (-not $t -or $t.StartsWith('#') -or $t.IndexOf('=') -lt 1) { continue }
  $i = $t.IndexOf('=')
  $k = $t.Substring(0, $i).Trim()
  $v = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
  $map[$k] = $v
}

function Report([string]$name) {
  $v = $map[$name]
  if ([string]::IsNullOrWhiteSpace($v)) { "$name=MISSING" }
  else { "$name=SET len=$($v.Length)" }
}

Report 'X_API_KEY'
Report 'X_API_SECRET'
Report 'X_BEARER_TOKEN'
Report 'X_MANAGER_ADMIN_TOKEN'
Report 'NEXT_PUBLIC_APP_URL'

$token = $map['X_MANAGER_ADMIN_TOKEN']
$base = 'http://127.0.0.1:3999'
$headers = @{ Authorization = "Bearer $token" }

Write-Output '---READINESS---'
try {
  $r = Invoke-WebRequest -Uri "$base/api/system/readiness" -Headers $headers -UseBasicParsing -TimeoutSec 8
  Write-Output "HTTP=$($r.StatusCode)"
  Write-Output $r.Content
} catch {
  Write-Output "READINESS_FAIL=$($_.Exception.Message)"
}

Write-Output '---USER---'
try {
  $r = Invoke-WebRequest -Uri "$base/api/user" -Headers $headers -UseBasicParsing -TimeoutSec 8
  Write-Output "HTTP=$($r.StatusCode)"
  Write-Output $r.Content
} catch {
  Write-Output "USER_FAIL=$($_.Exception.Message)"
}

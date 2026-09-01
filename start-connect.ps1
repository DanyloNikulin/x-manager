$ErrorActionPreference = 'Stop'
$envFile = 'D:\Services\x-manager\.env.production.local'
$map = @{}
foreach ($line in Get-Content -LiteralPath $envFile) {
  $t = $line.Trim()
  if (-not $t -or $t.StartsWith('#') -or $t.IndexOf('=') -lt 1) { continue }
  $i = $t.IndexOf('=')
  $map[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
}
$token = $map['X_MANAGER_ADMIN_TOKEN']
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3999/api/twitter/auth/start' -Method POST -Headers $headers -Body '{"slot":1}' -UseBasicParsing -TimeoutSec 20
  Write-Output "HTTP=$($r.StatusCode)"
  Write-Output $r.Content
} catch {
  $resp = $_.Exception.Response
  if ($resp) {
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
    Write-Output "HTTP=$([int]$resp.StatusCode)"
    Write-Output $reader.ReadToEnd()
  } else {
    Write-Output "FAIL=$($_.Exception.Message)"
  }
}

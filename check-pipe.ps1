$ErrorActionPreference = 'Stop'
Write-Output '---INBOX---'
foreach ($d in @('pending','claimed','outbox','done')) {
  $p = "C:\Users\nikul\x-post-validator\inbox\$d"
  Write-Output "DIR $d"
  if (Test-Path $p) { Get-ChildItem $p -Filter *.json | ForEach-Object { $_.Name } } else { Write-Output '(missing)' }
}

$envFile = 'D:\Services\x-manager\.env.production.local'
$map = @{}
foreach ($line in Get-Content -LiteralPath $envFile) {
  $t = $line.Trim()
  if (-not $t -or $t.StartsWith('#') -or $t.IndexOf('=') -lt 1) { continue }
  $i = $t.IndexOf('=')
  $map[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
}
$token = $map['X_MANAGER_ADMIN_TOKEN']
$headers = @{ Authorization = "Bearer $token" }

Write-Output '---DRAFTS---'
$r = Invoke-WebRequest -Uri 'http://127.0.0.1:3999/api/drafts' -Headers $headers -UseBasicParsing -TimeoutSec 8
Write-Output $r.Content

Write-Output '---SCHEDULER---'
$r2 = Invoke-WebRequest -Uri 'http://127.0.0.1:3999/api/scheduler/posts?account_slot=1&limit=20' -Headers $headers -UseBasicParsing -TimeoutSec 8
Write-Output $r2.Content.Substring(0, [Math]::Min(2500, $r2.Content.Length))

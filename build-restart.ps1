$ErrorActionPreference = 'Stop'
Set-Location 'D:\Services\x-manager'
$env:NODE_ENV = 'production'
$env:NEXT_TELEMETRY_DISABLED = '1'
$env:CI = '1'

Write-Output 'STOP_WEB'
try { Stop-ScheduledTask -TaskName 'XManager-Web' -ErrorAction SilentlyContinue } catch {}
Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 3999 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

Write-Output 'BUILD_START'
& node .\node_modules\next\dist\bin\next build
if ($LASTEXITCODE -ne 0) { throw "next build failed: $LASTEXITCODE" }
Write-Output 'BUILD_OK'

Start-ScheduledTask -TaskName 'XManager-Web'
Start-Sleep -Seconds 6
$task = Get-ScheduledTask -TaskName 'XManager-Web'
Write-Output "TASK_STATE=$($task.State)"
$listen = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 3999 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listen) { Write-Output "LISTEN_PID=$($listen.OwningProcess)" } else { Write-Output 'LISTEN_MISSING' }

Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
  if ($_.CommandLine -and $_.CommandLine -like '*next*build*') {
    Write-Output "KILL $($_.ProcessId) $($_.CommandLine)"
    Stop-Process -Id $_.ProcessId -Force
  }
}
Write-Output 'DONE'

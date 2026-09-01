Get-ScheduledTask -TaskName 'XManager-Web' | ForEach-Object {
  $_.TaskName
  $_.State
  $_.Actions | ForEach-Object { $_.Execute; $_.Arguments }
}
Get-ScheduledTaskInfo -TaskName 'XManager-Web'

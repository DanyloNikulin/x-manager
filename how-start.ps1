Get-ChildItem 'D:\Services\x-manager\bin' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }
Get-ChildItem 'D:\Services\x-manager\deploy' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }
Get-ScheduledTask | Where-Object { $_.TaskName -match 'x-manager|xmanager' } | ForEach-Object { $_.TaskName }
Get-CimInstance Win32_Service | Where-Object { $_.Name -match 'x-manager|xmanager|node' } | Select-Object Name, State, PathName
Get-Content 'D:\Services\x-manager\next.config.mjs' -ErrorAction SilentlyContinue

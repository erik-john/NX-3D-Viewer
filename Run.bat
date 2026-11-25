@echo off
setlocal
cd /d "%~dp0"
if /i "%~1"=="--firewall" goto setup_firewall
where py >nul 2>&1
if %errorlevel%==0 (
    py -3 backend\server.py %*
) else (
    python backend\server.py %*
)
exit /b %errorlevel%

:setup_firewall
if not "%~2"=="" (
    echo Usage: Run.bat --firewall
    exit /b 2
)
powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; try { $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent()); if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Open PowerShell as Administrator and run .\Run.bat --firewall again.' }; $rules=@(Get-NetFirewallRule -PolicyStore PersistentStore | Where-Object { $_.Name -eq 'NX3DViewer-LAN-TCP-8888' -or $_.DisplayName -eq 'NX 3D Viewer' }); if ($rules.Count -gt 0) { foreach ($r in $rules) { $p=Get-NetFirewallPortFilter -AssociatedNetFirewallRule $r; $a=Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $r; if ($r.Enabled -ne 'True' -or $r.Direction -ne 'Inbound' -or $r.Action -ne 'Allow' -or [int]$r.Profile -ne 3 -or $p.Protocol -notin @('TCP','6') -or @($p.LocalPort).Count -ne 1 -or $p.LocalPort -ne '8888' -or @($a.RemoteAddress).Count -ne 1 -or $a.RemoteAddress -ne 'LocalSubnet') { throw 'An existing NX 3D Viewer firewall rule has different settings. Review it in Windows Defender Firewall before continuing. No rule was changed.' } }; Write-Host 'Matching persistent firewall rule already exists. No changes made.'; } else { New-NetFirewallRule -PolicyStore PersistentStore -Name 'NX3DViewer-LAN-TCP-8888' -DisplayName 'NX 3D Viewer' -Direction Inbound -Protocol TCP -LocalPort 8888 -RemoteAddress LocalSubnet -Profile Private,Domain -Action Allow -Enabled True | Out-Null; Write-Host 'Firewall rule created for TCP 8888 on Private and Domain networks (LocalSubnet only).'; }; Write-Host 'Start the viewer separately: Run.bat --lan SERVER_IPV4'; exit 0; } catch { Write-Host ('Firewall setup failed: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }"
exit /b %errorlevel%

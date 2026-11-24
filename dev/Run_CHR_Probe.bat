@echo off
setlocal EnableExtensions
if "%~1"=="" (
  echo Drag a Siemens NX .chr file onto this script to create a read-only diagnostic.
  echo.
  pause
  exit /b 2
)
set "NXEXEC=%NX_RUN_JOURNAL%"
if not exist "%NXEXEC%" set "NXEXEC=D:\Works\Siemens\NX2506\NXBIN\run_journal.exe"
if not exist "%NXEXEC%" (
  echo NX run_journal.exe not found. Set NX_RUN_JOURNAL or update the default path.
  pause
  exit /b 2
)
set "REPORT=%~dpn1_nx_inspector_probe.json"
"%NXEXEC%" "%~dp0nx_inspector_api_probe.py" -args "%~f1" "%REPORT%"
if exist "%REPORT%" (
  echo Diagnostic saved to "%REPORT%"
  echo Share this JSON file to identify the NX 2506 Inspector accessors.
) else (
  echo The diagnostic file was not created. Check NX error output above.
)
pause

@echo off
setlocal EnableExtensions DisableDelayedExpansion
title NX 2506 - CHR Characteristics Diagnostic

rem Save the first log before doing any file or NX checks.
set "OUTDIR=%~dp0CHR_Probe_Output"
if not exist "%OUTDIR%\" mkdir "%OUTDIR%" >nul 2>&1
if not exist "%OUTDIR%\" set "OUTDIR=%LOCALAPPDATA%\NX_3D_Viewer_Probe"
if not exist "%OUTDIR%\" mkdir "%OUTDIR%" >nul 2>&1
if not exist "%OUTDIR%\" goto :no_output
set "LAUNCH_LOG=%OUTDIR%\CHR_Probe_Launch.log"
>"%LAUNCH_LOG%" echo CHR diagnostic launcher started.
if errorlevel 1 goto :no_output
>>"%LAUNCH_LOG%" echo Launcher location: "%~f0"

echo ==================================================
echo NX 2506 - CHR Characteristics Diagnostic
echo ==================================================
echo.
echo Report folder:
echo "%OUTDIR%"
echo.

if /I "%~1"=="/selftest" goto :selftest
if not exist "%~dp0nx_inspector_api_probe.py" goto :missing_journal

set "CHR_PATH=%~1"
if defined CHR_PATH goto :have_path
echo Paste the full path to your CHR file and press Enter.
echo Example: C:\Users\Admin\Downloads\Local_Viewer_files\Bolt M12x55_chr.chr
echo.
set /p "CHR_PATH=CHR file path: "
:have_path
set "CHR_PATH=%CHR_PATH:"=%"
if not defined CHR_PATH goto :no_chrc
if not exist "%CHR_PATH%" goto :bad_chrc
if /I not "%CHR_PATH:~-4%"==".chr" goto :wrong_type

for %%I in ("%CHR_PATH%") do set "CHR_BASENAME=%%~nI"
set "REPORT=%OUTDIR%\%CHR_BASENAME%_nx_inspector_probe.json"
set "LOG=%OUTDIR%\%CHR_BASENAME%_nx_inspector_probe.log"
>"%LOG%" echo NX Inspector probe started.
if errorlevel 1 goto :log_failed
>>"%LOG%" echo CHR: "%CHR_PATH%"
>>"%LOG%" echo Journal: "%~dp0nx_inspector_api_probe.py"

echo.
echo Input: "%CHR_PATH%"
echo JSON: "%REPORT%"
echo LOG: "%LOG%"
echo.

rem Read the optional NX_RUN_JOURNAL override without substring substitution.
rem In cmd.exe, substitution on an undefined variable can yield a stray = value.
set "NXEXEC=%NX_RUN_JOURNAL%"
if not defined NXEXEC set "NXEXEC=D:\Works\Siemens\NX2506\NXBIN\run_journal.exe"
rem Strip surrounding quotes only after NXEXEC is known to be defined.
set "NXEXEC=%NXEXEC:"=%"
if not exist "%NXEXEC%" goto :missing_nx

rem Delete stale report so previous output cannot look like success.
if exist "%REPORT%" del /Q "%REPORT%" >nul 2>&1
if exist "%REPORT%" goto :stale_report

echo Starting NX journal. Output is saved to the LOG file.
>>"%LOG%" echo NX executable: "%NXEXEC%"
"%NXEXEC%" "%~dp0nx_inspector_api_probe.py" -args "%CHR_PATH%" "%REPORT%" >>"%LOG%" 2>&1
set "NXRC=%ERRORLEVEL%"
>>"%LOG%" echo NX exit code: %NXRC%
echo NX exit code: %NXRC%
if exist "%REPORT%" goto :success

echo ERROR: NX did not create a JSON report.
>>"%LOG%" echo ERROR: NX did not create a JSON report.
goto :show_log

:success
echo.
echo JSON report was created successfully.
echo Upload this file: "%REPORT%"
if not "%NXRC%"=="0" echo NOTE: NX returned an error; the JSON may only contain diagnostics.
goto :show_log

:selftest
>>"%LAUNCH_LOG%" echo SELFTEST OK: BAT executed, and output folder is writable.
echo SELFTEST OK. Launcher and log creation work.
echo Log: "%LAUNCH_LOG%"
goto :finish

:missing_journal
echo ERROR: nx_inspector_api_probe.py is missing beside this BAT file.
echo Extract the COMPLETE ZIP before running; do not run the BAT inside the ZIP preview.
>>"%LAUNCH_LOG%" echo ERROR: NX journal missing. Extract complete ZIP.
goto :finish

:no_chrc
echo ERROR: No CHR path entered.
>>"%LAUNCH_LOG%" echo ERROR: No CHR path entered.
goto :finish

:bad_chrc
echo ERROR: CHR file not found: "%CHR_PATH%"
>>"%LAUNCH_LOG%" echo ERROR: CHR file not found: "%CHR_PATH%"
goto :finish

:wrong_type
echo ERROR: Please select a .chr file.
>>"%LAUNCH_LOG%" echo ERROR: Input is not a .chr file.
goto :finish

:missing_nx
echo ERROR: NX run_journal.exe was not found at "%NXEXEC%".
echo Check your NX 2506 installation, or set the NX_RUN_JOURNAL variable.
>>"%LOG%" echo ERROR: NX executable missing: "%NXEXEC%"
goto :show_log

:stale_report
echo ERROR: Cannot replace existing JSON. Close programs using it and retry.
>>"%LOG%" echo ERROR: Cannot replace old report.
goto :show_log

:log_failed
echo ERROR: Could not write to "%LOG%".
>>"%LAUNCH_LOG%" echo ERROR: Per-file log creation failed.
goto :finish

:no_output
echo ERROR: Cannot create diagnostic output folder under the project or LOCALAPPDATA.
echo Check folder permissions.
goto :finish

:show_log
echo.
echo ===== DIAGNOSTIC LOG =====
if exist "%LOG%" type "%LOG%"
echo.
echo Files are stored in: "%OUTDIR%"

:finish
echo.
echo Press any key to close this window.
pause >nul
endlocal
exit /b 0

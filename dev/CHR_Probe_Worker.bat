@echo off
setlocal EnableExtensions DisableDelayedExpansion
echo.
echo === Siemens NX Characteristics diagnostic ===
if "%~1"=="" goto :usage
if not exist "%~f1" goto :missing
if /I not "%~x1"==".chr" goto :wrong_type

set "REPORT=%~dpn1_nx_inspector_probe.json"
set "LOG=%~dpn1_nx_inspector_probe.log"
>"%LOG%" echo NX CHR diagnostic started for "%~f1"
if errorlevel 1 goto :temp_output
goto :output_ready

:temp_output
set "OUTPUT_DIR=%TEMP%\NX_3D_Viewer_Probe"
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"
set "REPORT=%OUTPUT_DIR%\%~n1_nx_inspector_probe.json"
set "LOG=%OUTPUT_DIR%\%~n1_nx_inspector_probe.log"
>"%LOG%" echo NX CHR diagnostic started for "%~f1"
if errorlevel 1 goto :cannot_log
echo Source folder was not writable. Using the TEMP directory.

:output_ready
echo CHR: "%~f1"
echo Report: "%REPORT%"
echo Log: "%LOG%"
set "NXEXEC=%NX_RUN_JOURNAL%"
if exist "%NXEXEC%" goto :nx_ready
set "NXEXEC=D:\Works\Siemens\NX2506\NXBIN\run_journal.exe"
if exist "%NXEXEC%" goto :nx_ready
>>"%LOG%" echo ERROR: NX run_journal.exe not found. Set NX_RUN_JOURNAL to the full executable path.
echo.
echo ERROR: NX run_journal.exe not found.
echo Set NX_RUN_JOURNAL or edit the default NXEXEC path in this script.
goto :show_log

:nx_ready
if exist "%REPORT%" goto :backup_report
goto :run_nx

:backup_report
copy /Y "%REPORT%" "%REPORT%.previous" >nul 2>&1
del /Q "%REPORT%" >nul 2>&1
if exist "%REPORT%" goto :cannot_reset_report

:run_nx
>>"%LOG%" echo NX executable: "%NXEXEC%"
>>"%LOG%" echo NX journal: "%~dp0nx_inspector_api_probe.py"
>>"%LOG%" echo --- NX output ---
echo Starting NX journal...
"%NXEXEC%" "%~dp0nx_inspector_api_probe.py" -args "%~f1" "%REPORT%" >>"%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
>>"%LOG%" echo --- NX exit code: %RC% ---
echo NX journal exit code: %RC%
if exist "%REPORT%" goto :success
echo ERROR: JSON was not created. Read the log below.
>>"%LOG%" echo ERROR: JSON output was not created.
goto :show_log

:success
echo.
echo JSON saved to: "%REPORT%"
echo Upload that JSON file to the chat.
if not "%RC%"=="0" echo NOTE: NX returned an error. The JSON may contain diagnostics only.
goto :show_log

:cannot_reset_report
>>"%LOG%" echo ERROR: Cannot replace previous JSON file. Close any program using it.
goto :show_log

:cannot_log
echo ERROR: Cannot create a log in either the source folder or TEMP.
goto :finish

:usage
echo Missing CHR file. Drag the .chr file onto Run_CHR_Probe.bat.
goto :finish

:missing
echo ERROR: File not found: "%~1"
goto :finish

:wrong_type
echo ERROR: Expected a .chr file, got "%~nx1".
goto :finish

:show_log
echo.
echo ===== Diagnostic log =====
if exist "%LOG%" type "%LOG%"
echo.
echo Log location: "%LOG%"

:finish
echo.
echo This window stays open. Close it after reviewing the results.
exit /b 0

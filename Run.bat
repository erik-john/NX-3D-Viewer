@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>&1
if %errorlevel%==0 (
    py -3 backend\server.py
) else (
    python backend\server.py
)
exit /b %errorlevel%

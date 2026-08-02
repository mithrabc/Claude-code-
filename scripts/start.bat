@echo off
REM Double-click launcher for Claude Remote on Windows.
REM Runs the PowerShell start script with the right execution policy.
setlocal
set "HERE=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%start.ps1" %*
echo.
echo Claude Remote stopped. Press any key to close.
pause >nul

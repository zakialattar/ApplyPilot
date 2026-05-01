@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%launch_applypilot_ui.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo ApplyPilot Control Center failed to launch. Exit code: %EXIT_CODE%
  pause
)

exit /b %EXIT_CODE%

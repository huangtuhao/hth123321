@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 20 or newer.
  pause
  exit /b 1
)

echo Starting LingXing Local Bridge in this visible window...
echo Close this window or press Ctrl+C to stop the service.
echo.
node.exe "%~dp0bridge.cjs"
set "BRIDGE_EXIT_CODE=%ERRORLEVEL%"

if not "%BRIDGE_EXIT_CODE%"=="0" (
  echo.
  echo Bridge exited with code %BRIDGE_EXIT_CODE%.
  pause
)
exit /b %BRIDGE_EXIT_CODE%

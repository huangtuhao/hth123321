@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "TASK_NAME=本地自动化桥"
set "OLD_TASK_NAME=领星本地数据桥"
set "VBS_PATH=%~sdp0run-bridge-hidden.vbs"
set "OLD_TASK_PRESENT=0"
set "HEALTH_FILE=%TEMP%\local-automation-bridge-health-%RANDOM%-%RANDOM%.json"

if not exist "%VBS_PATH%" (
  echo [ERROR] Missing %VBS_PATH%
  exit /b 1
)

schtasks.exe /Query /TN "%OLD_TASK_NAME%" >nul 2>nul
if not errorlevel 1 (
  set "OLD_TASK_PRESENT=1"
  schtasks.exe /End /TN "%OLD_TASK_NAME%" >nul 2>nul
  schtasks.exe /Change /TN "%OLD_TASK_NAME%" /Disable >nul 2>nul
)

rem Preserve the old task disabled for rollback, and wait for port 32145 to be released.
for /L %%I in (1,1,10) do (
  curl.exe --noproxy "*" -fsS http://127.0.0.1:32145/health >nul 2>nul
  if errorlevel 1 goto port_released
  timeout.exe /T 1 /NOBREAK >nul
)
echo [ERROR] Port 32145 is still occupied after stopping the old bridge.
goto rollback

:port_released
schtasks.exe /End /TN "%TASK_NAME%" >nul 2>nul
schtasks.exe /Create /TN "%TASK_NAME%" /SC ONLOGON /RL LIMITED /TR "%SystemRoot%\System32\wscript.exe //B //Nologo %VBS_PATH%" /F
if errorlevel 1 (
  echo [ERROR] Failed to create the scheduled task.
  goto rollback
)

schtasks.exe /Run /TN "%TASK_NAME%"
if errorlevel 1 (
  echo [ERROR] The task was created but could not be started.
  goto rollback
)

for /L %%I in (1,1,10) do (
  curl.exe --noproxy "*" -fsS -o "%HEALTH_FILE%" http://127.0.0.1:32145/health 2>nul
  if not errorlevel 1 (
    findstr.exe /C:"local-automation-bridge" "%HEALTH_FILE%" >nul
    if not errorlevel 1 goto verified
  )
  timeout.exe /T 1 /NOBREAK >nul
)
echo [ERROR] New bridge health check failed. Restoring the old task.
goto rollback

:verified
del /Q "%HEALTH_FILE%" >nul 2>nul
echo Installed and started scheduled task: %TASK_NAME%
echo The bridge now runs in the background without a CMD window.
pause
exit /b 0

:rollback
del /Q "%HEALTH_FILE%" >nul 2>nul
schtasks.exe /End /TN "%TASK_NAME%" >nul 2>nul
schtasks.exe /Change /TN "%TASK_NAME%" /Disable >nul 2>nul
if "%OLD_TASK_PRESENT%"=="1" (
  schtasks.exe /Change /TN "%OLD_TASK_NAME%" /Enable >nul 2>nul
  schtasks.exe /Run /TN "%OLD_TASK_NAME%" >nul 2>nul
)
echo [ERROR] Installation rolled back. The old bridge task was preserved when available.
pause
exit /b 1

@echo off
setlocal EnableExtensions

set "TASK_NAME=本地自动化桥"

echo ===========================================
echo   重启本地自动化桥
echo   （注册表在启动时加载，改配置后必须重启）
echo ===========================================
echo.

echo [1/3] 停止旧任务...
schtasks.exe /End /TN "%TASK_NAME%" >nul 2>nul
if errorlevel 1 (
  echo       未找到同名任务，可能不是后台任务方式运行，跳过。
) else (
  echo       已结束。
)

rem 等端口释放
for /L %%I in (1,1,10) do (
  curl.exe --noproxy "*" -fsS http://127.0.0.1:32145/health >nul 2>nul
  if errorlevel 1 goto port_free
  timeout.exe /T 1 /NOBREAK >nul
)
echo       [警告] 端口 32145 仍被占用，可能有手动启动的实例，请手动结束。
goto check
:port_free
echo [2/3] 端口已释放。

echo [3/3] 启动任务...
schtasks.exe /Run /TN "%TASK_NAME%" >nul 2>nul
if errorlevel 1 (
  echo       [错误] 启动失败，请手工运行 start-bridge.cmd
) else (
  echo       已启动。
)

:check
echo.
echo 健康检查（最多等 15 秒）...
set "OK="
for /L %%I in (1,1,15) do (
  curl.exe --noproxy "*" -fsS http://127.0.0.1:32145/health >"%TEMP%\bridge-health-check.json" 2>nul
  if not errorlevel 1 goto healthy
  timeout.exe /T 1 /NOBREAK >nul
)
echo [错误] 15 秒内未通过健康检查。
goto end

:healthy
echo.
echo 桥已就绪：
findstr /C:"\"version\"" "%TEMP%\bridge-health-check.json"

echo.
echo 校验新注册的资源是否生效...
curl.exe --noproxy "*" -s -X POST http://127.0.0.1:32145/v2/pair ^
  -H "Content-Type: application/json" ^
  -H "X-Local-Bridge-Client: userscript.lingxing.fba.tracking.v1" ^
  -d "{\"code\":\"00000000000000000000000000000000\"}" >"%TEMP%\bridge-pair-check.json" 2>nul
findstr /C:"客户端未注册" "%TEMP%\bridge-pair-check.json" >nul 2>nul
if errorlevel 1 (
  echo   [OK] 跟踪号插件客户端已注册
) else (
  echo   [警告] 仍提示"客户端未注册"，重启可能未成功
)

:end
echo.
echo 完成。可关闭此窗口。
pause

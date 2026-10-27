@echo off
rem Starts Lyric Studio in the background (a minimised window "LyricStudioServer"), waits until the
rem studio and the audio service answer, then opens the app. If it is already running the current code
rem it just opens it; if it is running an older build (after a git pull), it is stopped and started
rem again, which builds the new code first.
setlocal
cd /d "%~dp0"
echo Lyric Studio: checking the code...
set "CODE=unknown"
set "COMMIT=unknown"
for /f "tokens=1,2" %%a in ('node scripts\app-version.mjs') do (
  set "CODE=%%a"
  set "COMMIT=%%b"
)
set "RUNNING="
set "RUNCOMMIT="
call :running
if not defined RUNNING goto start
if not "%RUNNING%"=="%CODE%" goto restart
if "%CODE%"=="unknown" goto restart
echo Lyric Studio is already running the current code (commit %COMMIT%): opening it.
goto open

:restart
echo Lyric Studio is running an older build (commit %RUNCOMMIT%); the code is now commit %COMMIT%: restarting it.
call "%~dp0Stop Lyric Studio.cmd" quiet

:start
if not exist "logs" mkdir "logs"
rem Keep the previous log (it says why Lyric Studio stopped last time).
if exist "logs\lyric-studio.log" move /y "logs\lyric-studio.log" "logs\lyric-studio.previous.log" >nul
echo Starting Lyric Studio (commit %COMMIT%)...
start "LyricStudioServer" /min cmd /c "pnpm app:serve > logs\lyric-studio.log 2>&1"
echo Waiting for it to be ready. If the code changed since the last build it builds first (1-2 minutes);
echo what it is doing is in logs\lyric-studio.log
powershell -NoProfile -ExecutionPolicy Bypass -Command "$end=(Get-Date).AddMinutes(6); while((Get-Date) -lt $end){ try { Invoke-WebRequest http://127.0.0.1:3000/api/health -UseBasicParsing -TimeoutSec 2 | Out-Null; Invoke-WebRequest http://127.0.0.1:8001/health -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep -Seconds 2 } }; exit 1"
if errorlevel 1 (
  echo.
  echo Lyric Studio did not start within 6 minutes. The details are in logs\lyric-studio.log
  pause
  exit /b 1
)
set "RUNNING="
call :running
if not "%RUNNING%"=="%CODE%" (
  echo.
  echo Warning: the running build is commit %RUNCOMMIT%, the code is commit %COMMIT%.
  echo Stop Lyric Studio, run "pnpm app:rebuild", then start it again.
  pause
)
echo Lyric Studio is ready (commit %RUNCOMMIT%).

:open
rem Edge's app mode gives Lyric Studio its own window (or use the installed app, see README).
start "" msedge --app=http://localhost:3000
exit /b 0

rem The build that is running (RUNNING = its code version, RUNCOMMIT = its commit), or nothing.
:running
for /f "tokens=1,2" %%a in ('node scripts\app-running.mjs') do (
  set "RUNNING=%%a"
  set "RUNCOMMIT=%%b"
)
exit /b 0

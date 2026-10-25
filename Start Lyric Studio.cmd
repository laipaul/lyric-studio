@echo off
rem Starts Lyric Studio in the background (a minimised window "LyricStudioServer"), waits until the
rem studio and the audio service answer, then opens the app. If it is already running it just opens it.
setlocal
cd /d "%~dp0"
call :ready
if %errorlevel%==0 goto open

if not exist "logs" mkdir "logs"
echo Starting Lyric Studio...
start "LyricStudioServer" /min cmd /c "pnpm app:serve > logs\lyric-studio.log 2>&1"
echo Waiting for it to be ready (the first start after an update builds the app: 1-2 minutes)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$end=(Get-Date).AddMinutes(6); while((Get-Date) -lt $end){ try { Invoke-WebRequest http://127.0.0.1:3000/api/health -UseBasicParsing -TimeoutSec 2 | Out-Null; Invoke-WebRequest http://127.0.0.1:8001/health -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep -Seconds 2 } }; exit 1"
if errorlevel 1 (
  echo.
  echo Lyric Studio did not start within 6 minutes. The details are in logs\lyric-studio.log
  pause
  exit /b 1
)

:open
rem Edge's app mode gives Lyric Studio its own window (or use the installed app, see README).
start "" msedge --app=http://localhost:3000
exit /b 0

:ready
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest http://127.0.0.1:3000/api/health -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
exit /b %errorlevel%

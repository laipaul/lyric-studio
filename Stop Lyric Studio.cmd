@echo off
rem Stops Lyric Studio: the background process started by "Start Lyric Studio.cmd" (pnpm app:serve) with
rem everything under it (studio, worker, audio service; so nothing restarts itself), the background
rem window, and anything still listening on the studio / audio ports. Waits until they are free.
rem "Stop Lyric Studio.cmd quiet" (used by Start) does not pause at the end.
setlocal
cd /d "%~dp0"
echo Stopping Lyric Studio...
set "PID="
if exist "logs\lyric-studio.pid" set /p PID=<"logs\lyric-studio.pid"
if defined PID taskkill /PID %PID% /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq LyricStudioServer*" /T /F >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "$end=(Get-Date).AddSeconds(20); do { Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'app-serve\.mjs|studio,worker,audio' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F *> $null }; $busy = @(); foreach ($port in 3000, 8001) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $busy += $port; taskkill /PID $_.OwningProcess /T /F *> $null } }; if ($busy.Count -eq 0) { exit 0 }; Start-Sleep -Seconds 1 } while ((Get-Date) -lt $end); Write-Host 'Warning: something still listens on port 3000 or 8001 (another program?).'; exit 1"
if exist "logs\lyric-studio.pid" del "logs\lyric-studio.pid" >nul 2>&1
echo Lyric Studio stopped.
if /i not "%~1"=="quiet" timeout /t 2 >nul
exit /b 0

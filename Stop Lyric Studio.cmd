@echo off
rem Stops Lyric Studio: the background window started by "Start Lyric Studio.cmd" with everything in
rem it (studio, worker, audio service), and anything still listening on the studio / audio ports.
cd /d "%~dp0"
taskkill /FI "WINDOWTITLE eq LyricStudioServer*" /T /F >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "foreach ($port in 3000, 8001) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"
echo Lyric Studio stopped.
timeout /t 2 >nul

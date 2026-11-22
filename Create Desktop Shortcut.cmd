@echo off
rem Puts a "Lyric Studio" shortcut with the Life Lyrics icon (made from workspace\brand\logo.png) on
rem your desktop. It starts "Start Lyric Studio.cmd" minimised. Run it again after changing the logo
rem or brand.json "appIcon" ("logo" or "tile"): it updates the icon.
setlocal
cd /d "%~dp0"
set "ICON="
for /f "delims=" %%i in ('pnpm -s app:icons') do set "ICON=%%i"
if not defined ICON (
  echo Could not make the icon; see the message above.
  pause
  exit /b 1
)
copy /y "%ICON%" "Lyric Studio.ico" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Lyric Studio.lnk'); $s.TargetPath = '%~dp0Start Lyric Studio.cmd'; $s.WorkingDirectory = '%~dp0'; $s.IconLocation = '%~dp0Lyric Studio.ico'; $s.WindowStyle = 7; $s.Description = 'Lyric Studio'; $s.Save()"
rem A second shortcut, "Lyric Studio - Get Latest": gets the newest version from GitHub and restarts the app.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Lyric Studio - Get Latest.lnk'); $s.TargetPath = '%~dp0Get Latest Lyric Studio.cmd'; $s.WorkingDirectory = '%~dp0'; $s.IconLocation = '%~dp0Lyric Studio.ico'; $s.Description = 'Get the newest Lyric Studio and restart it'; $s.Save()"
rem Let Windows show the new icon now (it keeps old icons in a cache).
ie4uinit.exe -show >nul 2>&1
echo The "Lyric Studio" and "Lyric Studio - Get Latest" shortcuts are on your desktop (icon from workspace\brand\logo.png).
pause

@echo off
rem Gets the newest Lyric Studio from GitHub (the lyric-studio copy, where Claude puts every change), copies it to your
rem usual GitHub copy (videomaker) so both match, then installs and restarts the app (scripts\update.mjs). Your songs,
rem clips and characters (workspace) are never touched. Double-click it after Claude says a change is pushed.
cd /d "%~dp0" & node scripts\update.mjs --from lyric --copy-to origin & pause & exit /b

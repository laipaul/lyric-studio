@echo off
rem Gets the newest Lyric Studio from GitHub and starts it (scripts\update.mjs): a key typed into .env.example by
rem mistake is moved into .env first, so the update never stops on it. Nothing is ever sent to GitHub from here.
cd /d "%~dp0" & node scripts\update.mjs & pause & exit /b

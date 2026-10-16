@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer, then run this file again.
  pause
  exit /b 1
)
call npm ci
if errorlevel 1 goto failed
call npm run build
if errorlevel 1 goto failed
echo Open http://localhost:3000 in your browser. Keep this window open.
call npm start
pause
exit /b
:failed
echo Setup failed. Copy the error above into the chat.
pause
exit /b 1

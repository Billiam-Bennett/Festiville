@echo off
title Install the FestiVille app
cd /d "%~dp0"
echo Setting up the FestiVille desktop app.
echo The first time downloads about 100 MB, so give it a few minutes.
echo.
where npm >nul 2>&1
if errorlevel 1 goto nonode

echo [1/3] Installing the game server parts...
call npm install --no-audit --no-fund
if errorlevel 1 goto failed

echo.
echo [2/3] Installing the desktop app parts...
pushd desktop
call npm install --no-audit --no-fund
set result=%errorlevel%
popd
if not "%result%"=="0" goto failed

echo.
echo [3/3] Making the FestiVille shortcuts...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0desktop\make-shortcut.ps1"
if errorlevel 1 goto failed

echo.
echo All set! Double-click FestiVille on your desktop (it's in the Start menu too).
echo If an old server window is still open (npm start), close it first.
echo.
pause
exit /b 0

:nonode
echo Node.js isn't installed. Get the LTS version from https://nodejs.org and run this again.
pause
exit /b 1

:failed
echo.
echo Something went wrong. Take a screenshot of this window and send it to Claude.
pause
exit /b 1

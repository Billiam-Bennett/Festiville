@echo off
title FestiVille (with log)
cd /d "%~dp0.."
if not exist data mkdir data
echo Closing any frozen FestiVille copies...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -like '*festiville*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo.>> data\launch.log
echo ===== %date% %time% =====>> data\launch.log
echo Starting FestiVille. Leave this window open; it records what happens in data\launch.log.
set ELECTRON_ENABLE_LOGGING=1
set ELECTRON_ENABLE_STACK_DUMPING=1
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0." --enable-logging >> data\launch.log 2>&1
echo ===== FestiVille closed (exit code %errorlevel%) =====>> data\launch.log
echo.
echo FestiVille closed. You can close this window.
pause

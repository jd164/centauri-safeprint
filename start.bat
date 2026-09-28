@echo off
title Elegoo Centauri Carbon - SafePrint
echo ===================================================
echo   Centauri Carbon SafePrint - Anti-Runout Guard
echo ===================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js was not found on your system!
    echo Please install Node.js v18 or newer from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo Starting SafePrint server...
start http://localhost:3000
node src/server.js %*
pause

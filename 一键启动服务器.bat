@echo off
title Offline Mirror Web Server
cd /d "%~dp0"
echo ==================================================
echo   Offline Mirror Launcher
echo ==================================================
echo Starting local node server...
echo.
node server.js
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Failed to start local Node.js server!
    echo Please make sure Node.js is installed.
    echo.
)
pause

@echo off
title Autonomous Project Builder Desktop
cd /d "%~dp0"

echo ===================================================
echo   AUTONOMOUS PROJECT BUILDER - DESKTOP LAUNCHER
echo ===================================================
echo.

if not exist "node_modules\electron" (
    echo [INFO] Installing desktop dependencies...
    call npm install
)

echo [INFO] Starting Autonomous Project Builder Desktop Shell...
call npm run desktop:dev

pause

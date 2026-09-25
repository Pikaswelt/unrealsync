@echo off
title UnrealSync - UE5 Git & GitHub Manager
echo ===================================================
echo     UnrealSync - UE5 Git & GitHub Manager
echo ===================================================
echo.

if not exist node_modules (
    echo [1/2] Installing dependencies...
    call npm install
)

echo [2/2] Starting UnrealSync Server and UI...
echo.
echo Open http://localhost:5173 in your browser if it doesn't open automatically.
echo.

start http://localhost:5173
call npm run dev
pause

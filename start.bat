@echo off
title Synapse
cd /d "%~dp0"

echo.
echo   ========================================
echo          Synapse Starting...
echo   ========================================
echo.

:: ---- 1. Check Node.js ----
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=1 delims=." %%a in ('node -v 2^>^&1') do set NODE_VER=%%a
echo [OK] Node.js: %NODE_VER%

:: ---- 2. Check config.yaml ----
if not exist "config.yaml" (
    if exist "config.example.yaml" (
        copy config.example.yaml config.yaml >nul
        echo [WARN] config.yaml created from template.
        echo        Edit it to set api_key and LLM credentials, then re-run.
        start notepad config.yaml
    ) else (
        echo [ERROR] config.example.yaml missing. Re-clone the project.
    )
    pause
    exit /b 1
)
echo [OK] config.yaml: found

:: ---- 3. Install deps ----
if not exist "node_modules" (
    echo [INFO] Running npm install...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
)
echo [OK] Dependencies: ready

:: ---- 4. Kill zombie process on port 5890 ----
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5890" ^| findstr "LISTENING" 2^>nul') do (
    echo [WARN] Port 5890 occupied by PID %%a. Killing...
    taskkill /f /pid %%a >nul 2>&1
    if %errorlevel% equ 0 (
        echo [OK] Killed PID %%a
    ) else (
        echo [ERROR] Cannot kill PID %%a. Close it manually or change port.
        pause
        exit /b 1
    )
)

:: ---- 5. Start ----
echo.
echo [INFO] Starting server...
echo [INFO] Open http://localhost:5890 in browser
echo.

start "" "http://localhost:5890" 2>nul

node server.js

echo.
echo [INFO] Server stopped.
pause

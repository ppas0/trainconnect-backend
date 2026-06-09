@echo off
title TrainConnect Europe – Windows Setup
color 0B

echo.
echo  ============================================
echo   TrainConnect Europe v2.0 – Windows Setup
echo  ============================================
echo.

:: Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [FEHLER] Node.js nicht gefunden!
    echo  Bitte Node.js von https://nodejs.org herunterladen (v18 oder neuer).
    echo.
    pause
    exit /b 1
)

echo  [OK] Node.js gefunden: 
node --version

:: Install dependencies
echo.
echo  [1/3] Installiere Abhängigkeiten...
call npm install
if %errorlevel% neq 0 (
    echo  [FEHLER] npm install fehlgeschlagen
    pause
    exit /b 1
)

:: Create data directory
echo  [2/3] Erstelle Datenverzeichnis...
if not exist "data" mkdir data

:: Start server
echo  [3/3] Starte Server...
echo.
echo  ============================================
echo   Server läuft auf: http://localhost:3000
echo   Zum Stoppen: Strg+C drücken
echo  ============================================
echo.

:: Open browser after 2 seconds
start "" timeout /t 2 >nul && start http://localhost:3000

node server.js
pause

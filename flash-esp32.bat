@echo off
REM ============================================================
REM flash-esp32.bat — Auto-detect ESP32 COM port and flash firmware
REM Run from the project root directory.
REM ============================================================
setlocal enabledelayedexpansion

echo.
echo ============================================
echo   Smart Monitoring System - ESP32 Flasher
echo ============================================
echo.

REM --- Step 1: Auto-detect ESP32 COM port ---
set "PORT="
echo Scanning for connected ESP32 ports...

for /f "tokens=*" %%A in ('powershell -NoProfile -Command "$p = [System.IO.Ports.SerialPort]::GetPortNames(); if ($p) { if ($p -contains 'COM20') { 'COM20' } else { $p[0] } }"') do (
    set "PORT=%%A"
)

if not defined PORT (
    for /f "tokens=*" %%A in ('powershell -NoProfile -Command "Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'COM\d+' -and ($_.Name -match 'CP210|CH340|CH9102|FTDI|USB.*Serial|JTAG') } | ForEach-Object { if ($_.Name -match '(COM\d+)') { $matches[1] } } | Select-Object -First 1"') do (
        set "PORT=%%A"
    )
)

if not defined PORT (
    echo [WARNING] Could not auto-detect ESP32 port.
    set /p PORT="Enter COM port manually (e.g. COM20): "
)

if not defined PORT (
    echo [ERROR] No COM port specified. Exiting.
    exit /b 1
)

echo.
echo [OK] Detected target port: %PORT%
echo.

REM --- Step 2: Activate ESP-IDF environment & Flash ---
echo Flashing firmware to %PORT%...
cd /d "%~dp0firmware"
powershell -NoProfile -ExecutionPolicy Bypass -Command ". '.\activate-esp-idf.ps1'; idf.py -p %PORT% flash"

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Flash failed! Please verify that the ESP32 is plugged in and not opened in another serial monitor.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Flash complete! Device running on %PORT%
echo ============================================
pause

@echo off
REM ============================================================
REM start-server.bat — Start all Docker services for the
REM Smart Monitoring System (PostgreSQL, Mosquitto, Backend, Frontend, Caddy)
REM ============================================================
setlocal

echo.
echo ============================================
echo   Smart Monitoring System - Server Startup
echo ============================================
echo.

cd /d "%~dp0"

REM --- Check Docker is running ---
docker info >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Docker is not running. Please start Docker Desktop and try again.
    pause
    exit /b 1
)

REM --- Pull latest images and start all services ---
echo Starting all services with Docker Compose...
docker compose up -d --build

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Docker Compose failed! Check the output above.
    pause
    exit /b 1
)

echo.
echo Waiting for services to become healthy...
timeout /t 15 /nobreak >nul

REM --- Show service status ---
echo.
echo Service status:
docker compose ps

echo.
echo ============================================
echo   All services started!
echo.
echo   Frontend:  http://localhost
echo   API:       http://localhost:3000/health
echo   MQTT:      mqtts://localhost:18883
echo   Postgres:  localhost:5432
echo ============================================
echo.
pause


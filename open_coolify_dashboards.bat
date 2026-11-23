@echo off
title Open Coolify Server Dashboards (192.168.1.31)
echo ============================================================
echo   GLIMSTECH AI — COOLIFY LAN SERVER (192.168.1.31)
echo ============================================================
echo Checking connectivity to Coolify Server (192.168.1.31)...
ping -n 1 192.168.1.31 >nul
if errorlevel 1 (
    echo [ERROR] Unable to reach Coolify Server at 192.168.1.31.
    echo Please make sure your server is powered on and connected to LAN.
    pause
    exit /b 1
)

echo [SUCCESS] Coolify Server 192.168.1.31 is reachable!
echo.
echo Opening GlimsTech AI Operations Hub and API Docs in your browser:
echo 1. Frontend Operations Hub:  http://192.168.1.31:3000
echo 2. Backend Swagger API Docs: http://192.168.1.31:8001/docs
echo 3. Evolution Go Gateway:     http://192.168.1.31:4000
echo ============================================================

start http://192.168.1.31:3000
start http://192.168.1.31:8001/docs

echo Done! Dashboards opened in your browser.
timeout /t 3 /nobreak >nul

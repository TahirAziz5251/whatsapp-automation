@echo off
title Launch GlimsTech AI Local Servers (Windows Host)
echo ============================================================
echo   LAUNCHING GLIMSTECH AI LOCAL STACK (WINDOWS HOST)
echo   Note: This runs locally on your PC (localhost).
echo   For Coolify Server (192.168.1.31), manage it via Coolify UI.
echo ============================================================
echo 1. Launching Backend on Port 8000...
start "GlimsTech Backend API (Port 8000)" cmd /k "%~dp0run_backend.bat"
timeout /t 2 /nobreak >nul

echo 2. Launching Frontend on Port 3000...
start "GlimsTech Frontend Dashboards (Port 3000)" cmd /k "%~dp0run_frontend.bat"

echo ============================================================
echo   BOTH LOCAL SERVERS HAVE BEEN LAUNCHED!
echo   - Local Frontend Hub:     http://localhost:3000
echo   - Local Backend Docs:    http://localhost:8000/docs
echo ============================================================
timeout /t 3 /nobreak >nul

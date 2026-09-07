@echo off
:: Re-launch elevated if not already admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"

echo Registering scheduled task...
install_task.exe
if %errorlevel% neq 0 (
    echo install_task.exe failed.
    pause
    exit /b 1
)

echo Starting pi-analysis-agent.exe...
start "" "pi-analysis-agent.exe"

echo Waiting for agent to start...
timeout /t 3 /nobreak >nul

tasklist /FI "IMAGENAME eq pi-analysis-agent.exe" | find /I "pi-analysis-agent.exe" >nul
if %errorlevel% equ 0 (
    echo pi-analysis-agent.exe is running.
) else (
    echo pi-analysis-agent.exe does NOT appear to be running.
)

pause

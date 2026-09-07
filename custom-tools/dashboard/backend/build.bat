@echo off
cd /d "%~dp0"

echo Building frontend...
call npm --prefix ..\frontend install
call npm --prefix ..\frontend run build

echo Building backend exe...
call npm install
call npm run build

echo Done. See ..\bin\dashboard.exe
pause

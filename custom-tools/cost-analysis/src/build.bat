@echo off
cd /d "%~dp0"

pyinstaller --onefile --distpath ../bin --workpath ../build --specpath ../build --noconsole analyze.py
pyinstaller --onefile --distpath ../bin --workpath ../build --specpath ../build --noconsole --name pi-analysis-agent agent.py
pyinstaller --onefile --distpath ../bin --workpath ../build --specpath ../build install_task.py
pyinstaller --onefile --distpath ../bin --workpath ../build --specpath ../build pull_report.py

rmdir /s /q ..\build

echo Done.
pause

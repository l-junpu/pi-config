# Rebuilding the .exe files

Run from this directory (`cost-analysis/src`). Requires `pyinstaller` installed
(`pip install pyinstaller`).

```bash
cd "C:\Users\Jun Pu\.pi\agent\custom-tools\cost-analysis\src"

pyinstaller --onefile --distpath ../bin --workpath ../build --specpath ../build --noconsole analyze.py
pyinstaller --onefile --distpath ../bin --workpath ../build --specpath ../build --noconsole --name pi-analysis-agent agent.py
pyinstaller --onefile --distpath ../bin --workpath ../build --specpath ../build install_task.py
pyinstaller --onefile --distpath ../bin --workpath ../build --specpath ../build pull_report.py

rm -rf ../build
```

Or just double-click `build.bat` in this directory -- it runs the same commands,
including the `pi-analysis-agent` rename for `agent.py`.

In `bin/`, `setup.bat` registers the scheduled task and starts the agent immediately
(no logoff/logon required) -- run it after rebuilding to pick up changes.

Notes:
- `agent.py` needs `--noconsole` (runs as a background service). `analyze.py` also
  uses `--noconsole` here since it's typically invoked non-interactively via `agent.py`
  or scheduled tasks -- drop `--noconsole` if you want console output when running
  `analyze.exe` manually.
- `install_task.py` and `pull_report.py` are CLI tools, so no `--noconsole`.
- `--distpath ../bin` overwrites the existing exes in `cost-analysis/bin/` in place.
- `../build` is scratch output, safe to delete after each build.
- `agent.exe` bundles `analyze.py`'s code at build time (imported as a Python module,
  not called as a subprocess), so rebuilding `agent.exe` alone picks up `analyze.py`
  changes for the running service -- but rebuild `analyze.exe` too, since it's a
  standalone tool people may run directly.
- After rebuilding, redistribute updated exes to any already-deployed teammate PCs.

# Setting up the service on a teammate's PC

1. Copy the whole `cost-analysis` folder to
   `C:\Users\<username>\.pi\agent\tools\cost-analysis\` on their PC.
2. Run `bin\setup.bat` once (right-click -> Run as administrator, or let it
   self-elevate via the UAC prompt). This registers `pi-analysis-agent.exe` to
   auto-start on Windows logon via Task Scheduler *and* starts it immediately
   (no logoff/logon needed), then verifies the process is running.

Equivalent manual steps, if you'd rather not run `setup.bat`:

1. Run `bin\install_task.exe` once. This registers `pi-analysis-agent.exe` to
   auto-start on Windows logon via Task Scheduler (safe to re-run -- it
   overwrites the existing task in place instead of creating duplicates). It
   listens on port `8765` by default (`DEFAULT_PORT` in `agent.py`).
2. The service starts automatically on their **next** logon. If they don't want to
   log out and back in, start it immediately with:

   ```bash
   schtasks /Run /TN PiAgentCostAnalysisService
   ```

Other useful commands:

```bash
# Remove the scheduled task
schtasks /Delete /TN PiAgentCostAnalysisService /F

# Check the task's current status
schtasks /Query /TN PiAgentCostAnalysisService
```

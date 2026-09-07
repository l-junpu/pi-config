#!/usr/bin/env python3
"""
Registers the Pi Agent cost-analysis service to auto-start on Windows logon,
via Task Scheduler.

Safe to run multiple times (double-click repeatedly, etc.): it always uses
`schtasks /Create /F`, which overwrites the existing task definition in place
instead of creating a duplicate entry.

Stdlib only -- safe to freeze with PyInstaller (`pyinstaller --onefile install_task.py`).
"""

import subprocess
import sys
from pathlib import Path

TASK_NAME = "PiAgentCostAnalysisService"
DEFAULT_PORT = 8765


def script_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def resolve_agent_command() -> str:
    """Prefer the compiled agent.exe in the sibling bin/ folder (or next to this exe,
    if install_task.exe was itself placed in bin/); fall back to `python agent.py` in
    the sibling src/ folder for local/dev testing where only the .py files exist."""
    here = script_dir()
    candidates = [here / "agent.exe", here.parent / "bin" / "agent.exe"]
    for agent_exe in candidates:
        if agent_exe.exists():
            return f'"{agent_exe}"'

    agent_py_candidates = [here / "agent.py", here.parent / "src" / "agent.py"]
    for agent_py in agent_py_candidates:
        if agent_py.exists():
            return f'"{sys.executable}" "{agent_py}"'

    print(f"Error: could not find agent.exe or agent.py near {here}", file=sys.stderr)
    sys.exit(1)


def main():
    command = resolve_agent_command()

    result = subprocess.run(
        [
            "schtasks", "/Create",
            "/TN", TASK_NAME,
            "/TR", command,
            "/SC", "ONLOGON",
            "/RL", "LIMITED",
            "/F",  # overwrite if it already exists -- prevents duplicate registrations
        ],
        capture_output=True,
        text=True,
    )

    print(result.stdout.strip())
    if result.returncode != 0:
        print(result.stderr.strip(), file=sys.stderr)
        print(f"\nFailed to register task '{TASK_NAME}'.", file=sys.stderr)
        sys.exit(result.returncode)

    print(f"\nTask '{TASK_NAME}' registered. It will start on next logon.")
    print(f"To start it immediately without logging off: schtasks /Run /TN {TASK_NAME}")
    print(f"To remove it later: schtasks /Delete /TN {TASK_NAME} /F")


if __name__ == "__main__":
    main()

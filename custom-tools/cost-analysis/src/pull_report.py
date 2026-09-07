#!/usr/bin/env python3
"""
Pulls a cost/activity report from a remote (or local) Pi Agent cost-analysis
service and saves it locally under reports/<source-username>/ddmmmyy_report.md.

The <source-username> subfolder is taken from the X-Pi-Username header the
target agent.exe returns -- i.e. the username of the PC the report was
generated on, not the machine running this script.

Stdlib only -- safe to freeze with PyInstaller (`pyinstaller --onefile pull_report.py`).
"""

import argparse
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import analyze

DEFAULT_PORT = 8765


def pull_report(host: str, port: int, timeout: float = 10.0):
    """Returns (username, hostname, content) from the target agent's /report endpoint."""
    url = f"http://{host}:{port}/report"
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        content = resp.read().decode("utf-8")
        username = resp.headers.get("X-Pi-Username", "unknown-user")
        hostname = resp.headers.get("X-Pi-Hostname", host)
    return username, hostname, content


def main():
    parser = argparse.ArgumentParser(description="Pull a cost report from a Pi Agent cost-analysis service.")
    parser.add_argument("--host", default="localhost", help="Target agent host/IP (default: localhost).")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Target agent port (default: {DEFAULT_PORT}).")
    parser.add_argument("--output-dir", default=None,
                         help="Base reports directory to save into (default: cost-analysis/reports).")
    args = parser.parse_args()

    try:
        username, hostname, content = pull_report(args.host, args.port)
    except urllib.error.URLError as e:
        print(f"Error: could not reach agent at {args.host}:{args.port} - {e}", file=sys.stderr)
        sys.exit(1)

    base_dir = Path(args.output_dir) if args.output_dir else analyze.reports_dir()
    dest_dir = base_dir / username
    dest_dir.mkdir(parents=True, exist_ok=True)

    file_name = f"{datetime.now(timezone.utc).strftime('%d%b%y').lower()}_report.md"
    dest_path = dest_dir / file_name
    dest_path.write_text(content, encoding="utf-8")

    print(f"Pulled report from {hostname} ({username}) at {args.host}:{args.port}")
    print(f"Saved to {dest_path}")


if __name__ == "__main__":
    main()

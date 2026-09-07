#!/usr/bin/env python3
"""
Pi Agent cost-analysis background service.

Runs a persistent HTTP server on this PC. When pinged, it regenerates the
cost/activity report (reusing analyze.py) and returns the markdown content,
so a central dashboard can pull it over the network.

Endpoints:
  GET /health       -> {"status": "ok"}
  GET /report       -> regenerates + returns the latest report as text/markdown
  GET /report-json  -> regenerates + returns the latest report as structured JSON

Stdlib only -- safe to freeze with PyInstaller (`pyinstaller --onefile agent.py`).
"""

import argparse
import getpass
import json
import logging
import socket
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import analyze

DEFAULT_PORT = 8765

logs_dir = analyze.script_dir().parent / "logs"
logs_dir.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    filename=str(logs_dir / "agent.log"),
    level=logging.INFO,
    format="%(asctime)s %(message)s",
)
logger = logging.getLogger("pi-cost-agent")


class ReportHandler(BaseHTTPRequestHandler):
    server_version = "PiCostAgent/1.0"

    def _send(self, status: int, body: bytes, content_type: str):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({
                "status": "ok", "host": socket.gethostname(), "username": getpass.getuser()
            }).encode("utf-8")
            self._send(200, body, "application/json")
            return

        if self.path == "/report":
            try:
                report_path = analyze.generate_report(
                    default_provider=self.server.default_provider,
                    default_model=self.server.default_model,
                )
                content = report_path.read_text(encoding="utf-8")
                body = content.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/markdown; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("X-Pi-Username", getpass.getuser())
                self.send_header("X-Pi-Hostname", socket.gethostname())
                self.end_headers()
                self.wfile.write(body)
            except RuntimeError as e:
                body = json.dumps({"error": str(e)}).encode("utf-8")
                self._send(404, body, "application/json")
            except Exception as e:  # noqa: BLE001 -- report any unexpected failure to the caller
                body = json.dumps({"error": f"{type(e).__name__}: {e}"}).encode("utf-8")
                self._send(500, body, "application/json")
            return

        if self.path == "/report-json":
            try:
                data = analyze.generate_report_data(
                    default_provider=self.server.default_provider,
                    default_model=self.server.default_model,
                )
                body = json.dumps(data).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("X-Pi-Username", getpass.getuser())
                self.send_header("X-Pi-Hostname", socket.gethostname())
                self.end_headers()
                self.wfile.write(body)
            except RuntimeError as e:
                body = json.dumps({"error": str(e)}).encode("utf-8")
                self._send(404, body, "application/json")
            except Exception as e:  # noqa: BLE001 -- report any unexpected failure to the caller
                body = json.dumps({"error": f"{type(e).__name__}: {e}"}).encode("utf-8")
                self._send(500, body, "application/json")
            return

        self._send(404, b'{"error": "not found"}', "application/json")

    def log_message(self, fmt, *args):
        logger.info("%s - %s", self.address_string(), fmt % args)


def main():
    parser = argparse.ArgumentParser(description="Pi Agent cost-analysis background service.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Port to listen on (default: {DEFAULT_PORT}).")
    parser.add_argument("--host", default="0.0.0.0", help="Host/interface to bind to (default: 0.0.0.0).")
    parser.add_argument("--default-provider", default=analyze.DEFAULT_MODEL_PROVIDER,
                         help="Provider used for pricing local/unpriced models.")
    parser.add_argument("--default-model", default=analyze.DEFAULT_MODEL_ID,
                         help="Model id used for pricing local/unpriced models.")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), ReportHandler)
    server.default_provider = args.default_provider
    server.default_model = args.default_model

    logger.info("Pi Agent cost-analysis service listening on %s:%s", args.host, args.port)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down.")
        server.shutdown()


if __name__ == "__main__":
    main()

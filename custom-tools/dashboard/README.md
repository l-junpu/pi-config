# Pi Agent Cost Dashboard

Centralized dashboard that polls every teammate's `agent.exe` over the LAN and
displays aggregated cost/usage analytics. Runs on one "server" machine; everyone
else just points a browser at it.

## Dev setup (this machine, while building it out)

```bash
cd dashboard/backend
pip install -r requirements.txt
python main.py
```

The backend reads its settings from `dashboard/config/`:
- `hosts.json` -- teams + members (name/ip/port) to poll
- `subnet.json` -- CIDR range for on-demand subnet-sweep discovery
- `server.json` -- dashboard's own port + poll interval + default team

It serves the API at `http://localhost:<server.json port>/api/*` (currently
`7420`, still a placeholder -- change `config/server.json` to pick a real one).

Frontend dev server setup will be added here once the React app is scaffolded
(Step 4+ of the build plan).

## Production setup (server machine, no internet/Python required)

Not built yet -- this section will be filled in once the backend + frontend are
feature-complete (see Step 6 of the build plan). The plan:

1. On this dev machine (has internet):
   - `npm run build` the React app -> static files.
   - `pyinstaller --onefile main.py` from `dashboard/backend/` -> `dashboard.exe`,
     same pattern as `cost-analysis`'s `agent.exe`.
2. Copy to the server machine:
   - `dashboard.exe`
   - the built React static files (served directly by the backend via FastAPI's
     `StaticFiles` -- no Node/npm needed on the server)
   - the `config/` folder (`hosts.json`, `subnet.json`, `server.json`) -- kept as
     external files, not baked into the exe, so they can be edited without a
     rebuild
3. Run `dashboard.exe` on the server machine. Optionally register it to
   auto-start via Task Scheduler (same approach as `cost-analysis/install_task.py`).
4. Teammates just need `agent.exe` running on their own PC (see
   `cost-analysis/src/README.md` for that setup) -- they don't run anything from
   this `dashboard/` folder themselves.

## Prerequisite: teammates' agent.exe

Each polled host must be running `cost-analysis`'s `agent.exe` with the
`/report-json` endpoint (added in this project's Step 1) -- rebuild and
redistribute `agent.exe` to any teammate still on an older build. See
`cost-analysis/src/README.md`.

# Pi Agent Cost Dashboard

Centralized dashboard that polls every teammate's `pi-analysis-agent.exe` over the LAN and
displays aggregated cost/usage analytics. Runs on one "server" machine; everyone
else just points a browser at it.

## Dev setup (this machine, while building it out)

```bash
cd dashboard/backend
npm install
npm start
```

The backend reads its settings from `dashboard/config/`:
- `hosts.json` -- teams + members (name/ip/port) to poll
- `subnet.json` -- CIDR range for on-demand subnet-sweep discovery
- `server.json` -- dashboard's own port + poll interval + default team
- `discovered.json` -- persisted subnet-sweep results (IP, editable name,
  hostname/username, last seen) -- auto-created empty on first run, not
  required to exist beforehand

It serves the API at `http://localhost:<server.json port>/api/*` (`7420` by
default -- change `config/server.json` to pick a different one). Each
teammate's `pi-analysis-agent.exe` listens on port `8765` by default (see
`cost-analysis/src/agent.py`'s `DEFAULT_PORT`) -- this is the `port` value
used in `hosts.json`/`subnet.json`.

For frontend dev (hot reload):
```bash
cd dashboard/frontend
npm install
npm run dev
```
This runs Vite's dev server on `http://localhost:5173`, which proxies `/api`
requests to the backend on `7420` (see `frontend/vite.config.ts`).

## Production setup (server machine, no Node/npm required)

The backend is bundled into a single Windows `.exe` via `pkg`
(`@yao-pkg/pkg`), which embeds the Node runtime -- no Node install needed on
the target machine. It serves the built React app as static files itself, so
one exe + two folders is all you need.

1. On this dev machine (has Node -- works cross-platform, even from macOS):
   ```bash
   cd dashboard/backend
   npm install
   npm run build
   ```
   Or just double-click/run `dashboard/backend/build.bat` on Windows. This
   builds the React app (`frontend/dist`) and produces
   `dashboard/bin/dashboard.exe`.
2. Copy these to the server machine, preserving the folder structure:
   - `dashboard/bin/dashboard.exe`
   - `dashboard/frontend/dist/` (the built static files)
   - `dashboard/config/` (`hosts.json`, `subnet.json`, `server.json`) -- kept
     as external files, not baked into the exe, so they can be edited without
     a rebuild. `discovered.json` isn't required -- it's created automatically
     the first time someone runs a sweep.
3. Run `dashboard/bin/dashboard.exe` on the server machine. It listens on
   `http://localhost:<server.json port>` (default `7420`) and serves both the
   API and the frontend from that one process/port. Optionally register it to
   auto-start via Task Scheduler (same approach as
   `cost-analysis/install_task.py`).
4. Teammates just need `pi-analysis-agent.exe` running on their own PC (see
   `cost-analysis/src/README.md` for that setup) -- they don't run anything
   from this `dashboard/` folder themselves. Point a browser at
   `http://<server-machine-ip>:7420` to view the dashboard.

## Discovering hosts on the LAN

The "Discover Hosts" button sweeps the CIDR range in `config/subnet.json`
(bounded to 1024 hosts, e.g. a /22 or smaller) for anything answering on
`/health` at the configured port, after a confirmation prompt. Results persist
to `config/discovered.json`; each found IP gets an editable name (defaults to
the agent's reported username, click to rename -- never overwritten by later
sweeps) and, if not already a team member, an "+ Add to team" action that
feeds into the normal add-member flow.

**Important**: the sweep runs on whichever machine is running the backend
(the server), not the machine viewing the browser -- it scans the *server's*
LAN/subnet, so `subnet.json`'s CIDR should match the server's network.

## Prerequisite: teammates' pi-analysis-agent.exe

Each polled host must be running `cost-analysis`'s `pi-analysis-agent.exe` with the
`/report-json` endpoint (added in this project's Step 1) -- rebuild and
redistribute `pi-analysis-agent.exe` to any teammate still on an older build. See
`cost-analysis/src/README.md`.

## Packaging for distribution

Only these folders/files need to leave the dev machine -- nothing else in the
repo (source, `node_modules/`, etc.) is required:

```
dashboard/bin/dashboard.exe
dashboard/frontend/dist/
dashboard/config/
cost-analysis/bin/
```

- `dashboard/bin/dashboard.exe` + `dashboard/frontend/dist/` + `dashboard/config/`
  go on the **server** machine (see Production setup above).
- `cost-analysis/bin/` (all 4 exes: `pi-analysis-agent.exe`, `analyze.exe`,
  `install_task.exe`, `pull_report.exe`) goes on **every teammate's PC** that
  should be polled by the dashboard -- see `cost-analysis/src/README.md` for
  setup on each machine.

Zip/copy those 4 paths as-is, preserving their relative folder structure
(e.g. `dashboard.exe` still needs `frontend/dist/` and `config/` as siblings
one level up, per the Production setup steps above).

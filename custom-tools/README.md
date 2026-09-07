# Pi Agent Cost Tools

Two related tools for tracking Pi Agent usage/cost:

- **`cost-analysis/`** -- runs on every teammate's PC. Exposes a small local HTTP
  service (`agent.exe`) that reports that machine's own usage/cost.
- **`dashboard/`** -- runs on one "server" PC. Polls every teammate's `agent.exe`
  over the LAN and shows aggregated cost/usage in a browser.

There are two roles below: **Team member** (just runs `agent.exe`) and
**Server host** (runs the dashboard). Most people are only a team member.

---

## Team member setup

You need this if a teammate wants to see your usage on their dashboard.

1. Copy the whole `cost-analysis` folder to `C:\Users\<you>\.pi\agent\tools\cost-analysis\`
2. Run `bin\install_task.exe` once -- registers a Windows Task Scheduler task
   (`PiAgentCostAnalysisService`) that starts `agent.exe` on login.
3. To start it immediately without logging out/in: `schtasks /Run /TN PiAgentCostAnalysisService`

No further action needed -- it runs quietly in the background.

### Rebuilding cost-analysis after code changes

If `agent.py`, `analyze.py`, `install_task.py`, or `pull_report.py` change,
rebuild the `.exe` files (from `cost-analysis/src/`, requires Python + PyInstaller):

```bash
pyinstaller --onefile --distpath ../bin --workpath ../build --specpath ../build --noconsole analyze.py
pyinstaller --onefile --distpath ../bin --workpath ../build --specpath ../build --noconsole agent.py
pyinstaller --onefile --distpath ../bin --workpath ../build --specpath ../build install_task.py
pyinstaller --onefile --distpath ../bin --workpath ../build --specpath ../build pull_report.py
rm -rf ../build
```

`--noconsole` is used for `agent.py`/`analyze.py` since they run non-interactively
in the background; `install_task.py`/`pull_report.py` are CLI tools that need a
console. Full details in `cost-analysis/src/README.md`.

---

## Server host setup

You need this if you're the one running the dashboard that everyone else's
browser points at.

### Current status: Node.js required on the server PC

The dashboard backend isn't frozen into a standalone `.exe` yet (that's a
planned but not-yet-done step). For now, the server PC needs
[Node.js](https://nodejs.org/) installed to run it. The frontend, however, is
pre-built as static files on a dev machine and needs no Node/npm on the server
to serve -- see below.

### 1. Build the frontend (on a dev machine with Node/npm + internet)

```bash
cd dashboard/frontend
npm install
npm run build
```

`npm install` needs internet, but only here, on this dev machine -- it's never
run again on the server. This produces `dashboard/frontend/dist/`, plain
static HTML/CSS/JS. The server doesn't need Node/npm to serve these files;
the backend serves them directly (same port as the API) if the folder exists
-- see the caveat below about the backend itself still needing Node.

### 2. Copy to the server PC

Copy the whole `dashboard/` folder (including the `frontend/dist/` you just
built, `backend/`, and `config/`) to the server machine.

### 3. Configure

Edit `dashboard/config/`:
- `hosts.json` -- teams and their members (`name`, `ip`, `port`)
- `subnet.json` -- LAN CIDR range (for future subnet-sweep discovery)
- `server.json` -- the dashboard's own port and poll interval

You can also add/edit/remove teams and members later from the dashboard UI
itself (no need to hand-edit `hosts.json` after initial setup).

### 4. Install backend dependencies and run

```bash
cd dashboard/backend
npm install
npm start
```

**Internet requirement:** `npm install` downloads `express`/`cors`, so it
needs internet the first time it's run. If you'd rather not require internet
on the server PC: run `npm install` once on your dev machine, then copy the
resulting `dashboard/backend/node_modules/` folder over along with everything
else. None of the backend's dependencies have native/compiled bindings, so a
copied `node_modules/` works as-is on the server -- `npm start` there needs
no internet and no `npm install`, just Node.js itself installed to run it.

Then open `http://<server-ip>:<port>` (port from `config/server.json`,
currently `7420`) in a browser -- from the server machine itself or any other
PC on the LAN.

### Future: no-Node deployment

Planned: freeze `dashboard/backend` into a standalone `.exe` (same approach as
`cost-analysis`'s `agent.exe`), so the server PC needs neither Node/npm nor
internet access -- just the `.exe`, the built `frontend/dist/`, and
`config/`. Not implemented yet.

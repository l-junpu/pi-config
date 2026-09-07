# PRP: Pi Agent Cost Dashboard

## 1. Context

Existing pieces (already built, in `~/.pi/agent/tools/cost-analysis/`):

- `src/analyze.py` — scans a PC's own `~/.pi/agent/sessions/**/*.jsonl`, computes cost
  per turn using `~/.pi/agent/models-store.json` pricing (local/unpriced models fall back
  to a configurable model, default `anthropic/claude-sonnet-5`), counts LOC generated vs
  summary lines generated, and writes a Markdown report to
  `cost-analysis/reports/report_ddmmmyy.md`. Importable as `analyze.generate_report(...)`.
- `src/agent.py` → `bin/agent.exe` — persistent background HTTP service (stdlib
  `http.server`, `--noconsole` build, logs to `cost-analysis/logs/agent.log`). Endpoints:
  - `GET /health` → `{"status": "ok", "host": <hostname>, "username": <os user>}`
  - `GET /report` → regenerates + returns latest report as `text/markdown`, with
    `X-Pi-Username` / `X-Pi-Hostname` response headers identifying the source PC.
  - Default port `8765`.
- `src/install_task.py` → `bin/install_task.exe` — registers `agent.exe` to auto-start on
  Windows logon via Task Scheduler (`schtasks /Create ... /F`, idempotent — safe to
  re-run without creating duplicate task entries).
- `src/pull_report.py` → `bin/pull_report.exe` — CLI that pulls `/report` from a given
  `--host:--port` and saves it to `reports/<source-username>/ddmmmyy_report.md` on the
  machine that ran the pull.

All of the above is Python stdlib-only, frozen to standalone `.exe` via PyInstaller, so
target PCs don't need Python installed. Deployment convention: copy the whole
`cost-analysis` folder to `C:\Users\<username>\.pi\agent\tools\cost-analysis\` on each
teammate's PC, run `install_task.exe` once.

**Goal of this PRP**: build the missing piece — a centralized web dashboard that polls
every teammate's `agent.exe` over the LAN, aggregates their reports, and displays cost /
usage analytics. This dashboard runs on one server machine; everyone on the LAN can view
it in a browser (e.g. `http://192.168.0.201:<port>`).

## 2. Requirements (from stakeholder conversation)

1. **Frontend**: React (not stdlib HTML/JS — user explicitly prefers React).
2. **Host discovery**: two configurable modes —
   - **Explicit list**: a config file listing known teammates' IPs (+ optionally
     friendly names), pinged directly.
   - **Subnet sweep**: a config file specifying a subnet (e.g. `192.168.0.0/24`) to scan
     for any host with `agent.exe` reachable on the configured port.
   Both modes should be supported; not mutually exclusive (e.g. run explicit list by
   default, subnet sweep as an on-demand "discover new hosts" action).
3. **Deployment shape**: dashboard backend + frontend run together on one "server"
   machine on the LAN. Other users only need a browser pointed at
   `http://<server-ip>:<port>` — they do not run the dashboard themselves (they only run
   `agent.exe` locally, which the dashboard polls).
4. **Data flow**: dashboard backend calls `GET http://<teammate-ip>:8765/report` (reusing
   the same contract `pull_report.py` already validated) for each configured/discovered
   host, parses/aggregates, and serves that data to the React frontend via its own API.
5. Must handle **offline/unreachable hosts** gracefully (teammate's PC off, agent not
   running, firewall blocking, etc.) — should not break the whole dashboard.
6. **hosts.json is grouped by team**, each team containing named members mapped to an
   IP (see Section 7 for exact format).
7. **Drilldown UI**: Team -> expandable member list -> expandable individual member
   panel showing that member's overall usage stats, with a per-member "poll now"
   action scoped to just that host.
8. **Team collated statistics**: aggregated view of all members of the *currently
   selected* team's data together (not just per-individual) -- shown inline on the
   same page, not a separate route (see Section 6 for the single-page rationale).
9. **Global poll**: one button that polls every configured host, gated behind a
   confirmation dialog (since it fans out to every teammate's machine).
10. **Poll feedback**: toast/popup notifications indicating success or failure of a
    poll action, auto-dismissing after a few seconds (see Section 6 for library choice).
11. **Member management**: the dashboard must let the user add a member, remove a
    member, and move a member between teams (or create a new team) directly from the
    UI — writing back to `hosts.json` rather than requiring manual file edits.

## 3. Open Questions To Resolve At Implementation Start

These were not fully pinned down in the planning conversation — the implementer should
either make a reasonable default choice and note it, or ask the user before proceeding:

- **Backend language/framework**: prior pieces are Python; a Python backend (FastAPI or
  Flask) serving a JSON API + a separately built React app (static build served by the
  same backend, or a dev server proxy) keeps the stack consistent. Alternative: Node
  backend (Express) if the user wants a single-language (JS/TS) stack for backend +
  frontend. **Recommend confirming with user before starting** — this PRP assumes Python
  (FastAPI) + React as the default, but flag it explicitly at kickoff.
- **Polling model**: does the dashboard poll all configured hosts on every page load
  (simple, always-fresh, but slow if a host is down/timing out), on a background
  schedule with caching (faster page loads, slightly stale data), or on-demand via a
  "Refresh" button in the UI? Recommend: background scheduled poll (e.g. every N
  minutes, configurable) + manual "Refresh now" button, with last-successful-pull
  timestamp shown per host.
- **Persistence**: does historical data need to survive a dashboard restart (e.g. so
  "monthly" charts don't reset), or is it acceptable to only show what's been pulled
  since the dashboard last started? Recommend: persist pulled reports to disk (reuse the
  existing `reports/<username>/ddmmmyy_report.md` convention already produced by
  `pull_report.py` logic) so historical trend charts work across restarts, rather than
  building a database from scratch. A lightweight SQLite layer can be added later if
  querying flat Markdown files becomes a bottleneck — start simple.
- **Auth**: does anyone need to authenticate to view the dashboard, or is "reachable on
  the LAN" sufficient access control for this internal tool? Recommend: no auth for v1
  (matches the stated trust model — internal LAN, teammates), revisit if requirements
  change.
- **Port number**: user explicitly said "not 6969" as an example only — pick an
  unused port and confirm, or make it configurable via the server config file.

## 4. Proposed Architecture

```
dashboard/
  config/
    hosts.json           # explicit host list, grouped by team -- see Section 7 for exact format
    subnet.json           # sweep config: { "cidr": "192.168.0.0/24", "port": 8765 }
    server.json            # dashboard server settings: { "port": <dashboard-port>, "poll_interval_seconds": 300 }
  backend/
    main.py                 # FastAPI app: serves API + (optionally) the built React static files
    poller.py               # polls agent.exe /health + /report for each host, on schedule + on-demand
    aggregator.py            # parses pulled Markdown reports into structured data (reuse analyze.py's
                              #   `build_report` inputs where possible -- ideally agent.exe exposes a
                              #   JSON variant of its report data, not just Markdown, to avoid re-parsing
                              #   Markdown tables on the dashboard side -- see Section 5)
    store.py                # reads/writes pulled reports to disk under reports/<username>/...
    api/
      routes_teams.py         # GET /api/teams -> team names + members tree from hosts.json (used to
                               #   populate the team selector dropdown), each member's last-known
                               #   online/offline status
      routes_reports.py       # GET /api/reports?member=<name>&range=day|week|month|all -> one member's
                               #   aggregated cost data (used by MemberStatsPanel)
                               # GET /api/reports/team/<team>?range=... -> collated stats for the
                               #   currently-selected team (used by TeamSummaryStrip)
      routes_refresh.py       # POST /api/refresh/member/<name> -> poll just this one host
                               # POST /api/refresh/team/<team>   -> poll all members of one team
                               # POST /api/refresh/all           -> poll every configured host (global button,
                               #   gated behind a confirm dialog on the frontend)
                               # All refresh endpoints return a per-host result summary (ok/offline/error)
                               #   so the frontend can render one toast per action, or a rollup toast for
                               #   team/all polls (e.g. "7/9 hosts updated, 2 offline").
      routes_members.py        # POST   /api/members              -> add a member { team, name, ip, port }
                               # DELETE /api/members/<name>        -> remove a member
                               # PATCH  /api/members/<name>         -> move member to a different team
                               #   (and/or update ip/port), or rename
                               # POST   /api/teams                  -> create a new (initially empty) team
                               # DELETE /api/teams/<team>            -> remove a team (only if empty, or
                               #   require moving/removing its members first -- confirm with user)
                               # All of the above read-modify-write `config/hosts.json` atomically (write
                               #   to a temp file + rename, to avoid corrupting the config if the process
                               #   is interrupted mid-write) and return the updated teams tree.
  frontend/
    (React app -- Vite + TypeScript)
    src/
      components/
        TeamSelector.tsx         # single dropdown: pick a team from hosts.json, defaults to
                                  #   server.json's `default_team`, remembers last choice in localStorage
        TeamSummaryStrip.tsx      # collated stats for the *selected* team -- CostSummary +
                                  #   ModelBreakdownTable + CostTrendChart, collapsed by default
        MemberList.tsx            # member rows for the selected team
        MemberStatsPanel.tsx       # expandable per-member preview: CostSummary + ModelBreakdownTable
                                    #   + "Poll now" button for just this member + edit/remove actions
        CostSummary.tsx            # totals: cost, tokens, LOC, summary lines (mirrors analyze.py's Summary section)
        CostTrendChart.tsx         # daily/weekly/monthly cost over time
        ModelBreakdownTable.tsx     # all-time-by-model table (mirrors analyze.py's All-Time Breakdown)
        GlobalPollButton.tsx         # header button -> confirm dialog -> POST /api/refresh/all
        PollConfirmDialog.tsx        # generic confirm dialog, reused for member/team removal too
        MemberManagementModal.tsx     # add-member form (applies to selected team) + edit member
                                       #   (move to a different team / update ip-port) + "+ New Team"
      api/
        client.ts                   # calls dashboard backend's /api/* endpoints
      App.tsx                       # single route "/" -- team selector drives which data is shown,
                                     #   no client-side routing needed

    Toast notifications: use `react-hot-toast` (or `react-toastify`) for poll
    success/failure feedback, auto-dismissing after a few seconds -- wired into
    `GlobalPollButton`, `PollConfirmDialog`, and each member's "Poll now" action.
```

## 5. Key Design Decision To Flag: JSON vs Markdown Report Contract

`agent.exe`'s `/report` endpoint currently returns **Markdown** (human-readable, good for
`pull_report.py`'s file-saving use case). For a dashboard that needs to chart/aggregate
data across many hosts, re-parsing Markdown tables on every poll is fragile and
unnecessary work.

**Recommendation**: add a second endpoint to `agent.py`, e.g. `GET /report-json`, that
calls the same `analyze.generate_report()` pipeline but returns the structured
aggregate data (the `results`/`totals`/`by_model`/`by_day` dicts already computed inside
`build_report()` before they're rendered to Markdown strings) as JSON. This requires a
small refactor of `analyze.py`: extract the data-aggregation step from
`build_report()`'s Markdown-string-building step, so both `/report` (Markdown) and
`/report-json` (structured data) can reuse the same aggregation without duplicating
logic. Keep `/report` (Markdown) for humans/`pull_report.py`, add `/report-json` for the
dashboard.

This is new work not yet done in `cost-analysis/` — call this out at the start of
implementation as a required prerequisite change to `analyze.py` + `agent.py` before the
dashboard backend can consume clean data.

## 6. Frontend UX / Page Structure

**Single-page design** (no separate "collated stats" route — a second page would mostly
duplicate the same summary/model-breakdown components for little benefit on an
internal LAN tool with a handful of teams):

```
[ Team selector dropdown ]  (defaults to a configurable team, e.g. server.json's
                             "default_team"; remembers last-selected team in local
                             storage for convenience)

[ Team collated summary strip ]  -- minimal/collapsed by default, expandable:
    total team cost, combined all-time-by-model table, combined daily/weekly/monthly
    trend chart. Recomputed whenever the selected team changes. This *is* the
    "project team collated statistics" requirement -- no separate page needed.

[ Member list for the selected team ]
    -> Individual member row (minimized stat dropdown by default):
         - name, online/offline status (from last /health poll)
         - expand/collapse to preview their overall usage stats (cost summary,
           all-time-by-model table, daily/weekly/monthly -- same shape as
           analyze.py's report, rendered as React components, not raw Markdown)
         - "Poll now" button/icon -- polls *only this host*
         - edit (move to another team / update ip-port) and remove actions

[ + Add Member ]  -- form/modal, applies to the currently selected team
[ + New Team ]     -- secondary action, e.g. in the team selector's dropdown footer

[ Poll All Users ] -- persistent header button, global (all teams, not just selected)
```

Everything lives on one route; switching the team dropdown just re-fetches/re-renders
the summary strip + member list for that team, rather than navigating away.

**Member management**: "+ Add Member" applies to whichever team is currently selected
in the dropdown (per the requirement). Each member row's edit action can move that
member to a *different* team via a team-picker (which updates the selected view
accordingly once saved). All writes go through the backend's `/api/members` /
`/api/teams` routes (Section 4), which persist to `config/hosts.json`. Confirm
destructive actions (remove member/team) with the same `PollConfirmDialog`-style pattern
used for polling, and surface success/failure via the same toast system.

**Global poll control**: a persistent button (e.g. top nav/header) — "Poll All Users".
Clicking it opens a confirmation dialog (since this fans out a request to every
configured host across *all* teams, not just the selected one, and could take a while /
hit offline machines) before firing `POST /api/refresh/all`.

**Poll result notifications**: toast/snackbar popups indicating success or failure per
poll action (individual host poll, or a summary after a global poll — e.g. "7/9 hosts
updated successfully, 2 offline"), auto-dismissing after a few seconds. Recommended
library: **`react-hot-toast`** (small, no dependencies, simple `toast.success()` /
`toast.error()` API, built-in auto-dismiss timer) — alternative: `react-toastify` if more
customization is needed later. Don't build a custom toast system from scratch.

## 7. Config File Formats

**`config/hosts.json`** (explicit list mode, grouped by team):
```json
{
  "teams": [
    {
      "team": "team-alpha",
      "members": [
        { "name": "alice", "ip": "192.168.0.42", "port": 8765 },
        { "name": "bob",   "ip": "192.168.0.43", "port": 8765 }
      ]
    },
    {
      "team": "team-beta",
      "members": [
        { "name": "carol", "ip": "192.168.0.50", "port": 8765 }
      ]
    }
  ]
}
```
Each member's `name` is the display name used throughout the UI (team drilldown, host
list, per-user poll target) -- independent of the OS username reported by `agent.exe`'s
`X-Pi-Username` header, though they'll often match. Backend should key pulled
reports/status by this config `name`, not by hostname/IP, so the UI stays stable even if
a teammate's IP changes (re-map in config, no data loss).

**`config/subnet.json`** (sweep mode):
```json
{
  "cidr": "192.168.0.0/24",
  "port": 8765,
  "timeout_ms": 500
}
```

**`config/server.json`** (dashboard's own settings):
```json
{
  "port": 7420,
  "poll_interval_seconds": 300,
  "default_team": "team-alpha"
}
```

## 8. Build Order (suggested)

1. **Prerequisite refactor**: add `/report-json` to `agent.py` (structured data), keep
   `/report` (Markdown) unchanged. Rebuild + redistribute `agent.exe` to any already-
   deployed PCs once this lands.
2. **Backend skeleton**: FastAPI app with `/api/teams`, `/api/reports`,
   `/api/refresh/member/<name>`, `/api/refresh/team/<team>`, `/api/refresh/all`; host
   list loader for both explicit-list (team-grouped) and subnet-sweep config modes;
   poller that hits `/health` then `/report-json` per host, with per-host timeout +
   graceful failure (mark host "offline", don't block others — likely `asyncio`/thread
   pool for concurrent polling of many hosts).
3. **Persistence**: store each successful pull under
   `dashboard/reports/<username>/ddmmmyy_report.json` (or reuse `cost-analysis`'s
   existing `reports/` layout — decide during implementation) so history survives
   restarts.
4. **Frontend**: React app scaffold -- single page: team selector, team summary strip,
   member list with expandable per-member stats -- wire up to backend API.
5. **Packaging/run**: decide how the server machine runs this persistently (Windows
   service / Task Scheduler entry for the backend, similar to `install_task.py`'s
   pattern; frontend built to static files and served by the backend, or run via a
   separate `npm run dev`/`serve` process — confirm preference before building).
6. **Test with 1 PC first** (per user's existing pattern of validating locally before
   multi-PC rollout), then validate with a second real teammate PC on the LAN before
   wider rollout.
7. **Member management UI**: add/remove/move-team flows wired to the backend's
   `/api/members` / `/api/teams` routes, with atomic writes to `config/hosts.json` and
   confirmation dialogs for destructive actions.

## 9. Non-Goals (explicitly out of scope for this PRP)

- Authentication/authorization (see Section 3 — revisit only if requirements change).
- Cross-subnet / VPN / remote-over-internet access (LAN-only per stated requirements).
- Historical data migration tooling (no existing dashboard data to migrate from).
- Alerting/notifications (e.g. "cost exceeded $X") — not requested, don't build
  speculatively.

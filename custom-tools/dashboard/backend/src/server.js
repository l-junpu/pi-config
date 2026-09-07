// Pi Agent Cost Dashboard backend.
// Run from this directory: `npm start`

import { existsSync } from "node:fs";
import path from "node:path";

import cors from "cors";
import express from "express";

import * as config from "./config.js";
import * as poller from "./poller.js";
import * as store from "./store.js";
import teamsRouter from "./routes/teams.js";
import reportsRouter from "./routes/reports.js";
import refreshRouter from "./routes/refresh.js";
import configRouter from "./routes/config.js";
import discoverRouter from "./routes/discover.js";

store.hydrateFromDisk(config.loadHosts());

const app = express();
app.use(cors());
app.use(express.json());

app.use(teamsRouter);
app.use(reportsRouter);
app.use(refreshRouter);
app.use(configRouter);
app.use(discoverRouter);

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// Serves the built React app (dashboard/frontend/dist) if present, so the whole
// dashboard runs from this one process/port. Falls back to API-only if the
// frontend hasn't been built yet (e.g. during backend-only development).
const frontendDist = path.join(config.dashboardDir(), "frontend", "dist");
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(frontendDist, "index.html")));
}

async function pollLoop(intervalSeconds) {
  for (;;) {
    try {
      const hosts = config.loadHosts();
      const entries = config.iterMembers(hosts);
      if (entries.length > 0) await poller.pollMembers(entries);
    } catch (e) {
      console.error("[pollLoop] error:", e);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
}

const serverConfig = config.loadServer();
const port = serverConfig.port ?? 7420;

app.listen(port, "0.0.0.0", () => {
  console.log(`Pi Agent Cost Dashboard backend listening on port ${port}`);
  pollLoop(serverConfig.poll_interval_seconds ?? 300);
});

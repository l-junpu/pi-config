import { Router } from "express";
import * as config from "../config.js";
import * as poller from "../poller.js";

const router = Router();

// POST /api/refresh/member/:name
router.post("/api/refresh/member/:name", async (req, res) => {
  const { name } = req.params;
  const { team, member } = config.findMember(name);
  if (!member) {
    return res.status(404).json({ detail: `Unknown member '${name}'` });
  }

  const results = await poller.pollMembers([{ team, member }]);
  res.json({ results });
});

// POST /api/refresh/team/:team
router.post("/api/refresh/team/:team", async (req, res) => {
  const { team } = req.params;
  const hosts = config.loadHosts();
  const teamEntry = (hosts.teams ?? []).find((t) => t.team === team);
  if (!teamEntry) {
    return res.status(404).json({ detail: `Unknown team '${team}'` });
  }

  const entries = (teamEntry.members ?? []).map((member) => ({ team, member }));
  const results = await poller.pollMembers(entries);
  const online = results.filter((r) => r.status === "online").length;
  res.json({ results, summary: `${online}/${results.length} hosts updated` });
});

// POST /api/refresh/all
router.post("/api/refresh/all", async (req, res) => {
  const hosts = config.loadHosts();
  const entries = config.iterMembers(hosts);
  const results = await poller.pollMembers(entries);
  const online = results.filter((r) => r.status === "online").length;
  res.json({ results, summary: `${online}/${results.length} hosts updated` });
});

export default router;

import { Router } from "express";
import * as config from "../config.js";
import * as store from "../store.js";

const router = Router();

// POST /api/teams { team: string }
router.post("/api/teams", (req, res) => {
  const { team } = req.body ?? {};
  if (!team || typeof team !== "string" || !team.trim()) {
    return res.status(400).json({ detail: "team is required" });
  }

  const hosts = config.loadHosts();
  if (hosts.teams.some((t) => t.team === team)) {
    return res.status(409).json({ detail: `Team '${team}' already exists` });
  }

  hosts.teams.push({ team, members: [] });
  config.saveHosts(hosts);
  res.status(201).json({ team, members: [] });
});

// POST /api/teams/:team/members { name, ip, port }
router.post("/api/teams/:team/members", (req, res) => {
  const { team } = req.params;
  const { name, ip, port } = req.body ?? {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ detail: "name is required" });
  }
  if (!ip || typeof ip !== "string" || !ip.trim()) {
    return res.status(400).json({ detail: "ip is required" });
  }

  const hosts = config.loadHosts();
  const teamEntry = hosts.teams.find((t) => t.team === team);
  if (!teamEntry) {
    return res.status(404).json({ detail: `Unknown team '${team}'` });
  }

  const { member: existing } = config.findMember(name, hosts);
  if (existing) {
    return res.status(409).json({ detail: `Member '${name}' already exists` });
  }

  const member = { name, ip, port: Number(port) || 8765 };
  teamEntry.members.push(member);
  config.saveHosts(hosts);
  res.status(201).json(member);
});

// PATCH /api/teams/:team/members/:name { ip?, port? }
router.patch("/api/teams/:team/members/:name", (req, res) => {
  const { team, name } = req.params;
  const { ip, port } = req.body ?? {};

  const hosts = config.loadHosts();
  const teamEntry = hosts.teams.find((t) => t.team === team);
  if (!teamEntry) {
    return res.status(404).json({ detail: `Unknown team '${team}'` });
  }

  const member = teamEntry.members.find((m) => m.name === name);
  if (!member) {
    return res.status(404).json({ detail: `Unknown member '${name}' in team '${team}'` });
  }

  if (ip && typeof ip === "string" && ip.trim()) member.ip = ip.trim();
  if (port) member.port = Number(port) || member.port;

  config.saveHosts(hosts);
  res.json(member);
});

// DELETE /api/teams/:team/members/:name
router.delete("/api/teams/:team/members/:name", (req, res) => {
  const { team, name } = req.params;

  const hosts = config.loadHosts();
  const teamEntry = hosts.teams.find((t) => t.team === team);
  if (!teamEntry) {
    return res.status(404).json({ detail: `Unknown team '${team}'` });
  }

  const before = teamEntry.members.length;
  teamEntry.members = teamEntry.members.filter((m) => m.name !== name);
  if (teamEntry.members.length === before) {
    return res.status(404).json({ detail: `Unknown member '${name}' in team '${team}'` });
  }

  config.saveHosts(hosts);
  store.removeMember(name);
  res.status(204).end();
});

export default router;

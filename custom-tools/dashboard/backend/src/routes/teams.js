import { Router } from "express";
import * as config from "../config.js";
import * as store from "../store.js";

const router = Router();

// GET /api/teams -- teams/members tree from hosts.json, with each member's
// last-known online/offline status merged in from the in-memory store.
router.get("/api/teams", (req, res) => {
  const hosts = config.loadHosts();
  const state = store.getAllState();

  const teams = (hosts.teams ?? []).map((team) => ({
    team: team.team,
    members: (team.members ?? []).map((member) => {
      const memberState = state[member.name];
      return {
        name: member.name,
        ip: member.ip,
        port: member.port ?? 8765,
        status: memberState ? memberState.status : "unknown",
        last_polled: memberState ? memberState.lastPolled : null,
      };
    }),
  }));

  res.json({ teams });
});

export default router;

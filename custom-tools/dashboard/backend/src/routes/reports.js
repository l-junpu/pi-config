import { Router } from "express";
import * as aggregator from "../aggregator.js";
import * as config from "../config.js";
import * as store from "../store.js";

const router = Router();
const VALID_RANGES = ["day", "week", "month", "all"];

function validateRange(range, res) {
  if (!VALID_RANGES.includes(range)) {
    res.status(400).json({ detail: `range must be one of ${VALID_RANGES.join(", ")}` });
    return false;
  }
  return true;
}

// GET /api/reports?member=<name>&range=day|week|month|all
router.get("/api/reports", (req, res) => {
  const { member, range = "all" } = req.query;
  if (!validateRange(range, res)) return;

  const memberState = store.getMemberState(member);
  if (memberState === null) {
    return res.status(404).json({ detail: `No data for member '${member}' yet -- poll it first` });
  }
  if (memberState.report === null) {
    return res.json({
      name: member,
      status: memberState.status,
      error: memberState.error,
      last_polled: memberState.lastPolled,
      report: null,
    });
  }

  // Even when offline, we still return the last-known report so historical
  // usage keeps showing -- `status` tells the UI it's stale.
  const filtered = aggregator.filterByRange(memberState.report, range);
  res.json({
    name: member,
    status: memberState.status,
    error: memberState.error,
    last_polled: memberState.lastPolled,
    report: filtered,
  });
});

// GET /api/reports/team/:team?range=day|week|month|all
router.get("/api/reports/team/:team", (req, res) => {
  const { team } = req.params;
  const { range = "all" } = req.query;
  if (!validateRange(range, res)) return;

  const hosts = config.loadHosts();
  const teamEntry = (hosts.teams ?? []).find((t) => t.team === team);
  if (!teamEntry) {
    return res.status(404).json({ detail: `Unknown team '${team}'` });
  }

  // Members are included in the totals using their last-known report even when
  // currently offline -- memberStatuses tells the UI who's actually reachable.
  const reports = [];
  const memberStatuses = [];
  for (const member of teamEntry.members ?? []) {
    const memberState = store.getMemberState(member.name);
    if (memberState && memberState.report) {
      reports.push(memberState.report);
    }
    memberStatuses.push({ name: member.name, status: memberState ? memberState.status : "unknown" });
  }

  const merged = aggregator.mergeReports(reports);
  const filtered = aggregator.filterByRange(merged, range);
  res.json({ team, members: memberStatuses, report: filtered });
});

export default router;

// In-memory store of the latest polled state per member, backed by on-disk
// snapshots (dashboard/reports/<name>/ddmmmyy_report.json) so data survives a
// backend restart instead of showing empty until the next poll cycle.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { dashboardDir } from "./config.js";

const state = new Map();

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function reportsDir() {
  return path.join(dashboardDir(), "reports");
}

function memberReportsDir(name) {
  return path.join(reportsDir(), name);
}

function ddmmmyy(date) {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = MONTHS[date.getUTCMonth()];
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${day}${month}${year}`;
}

function persistReport(name, report, polledAt) {
  const dir = memberReportsDir(name);
  mkdirSync(dir, { recursive: true });
  const fileName = `${ddmmmyy(new Date(polledAt))}_report.json`;
  writeFileSync(path.join(dir, fileName), JSON.stringify({ polled_at: polledAt, report }, null, 2), "utf-8");
}

/** Returns { report, polledAt } for the most recently written snapshot, or null. */
function loadLatestReportFromDisk(name) {
  const dir = memberReportsDir(name);
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir).filter((f) => f.endsWith("_report.json")).sort();
  if (files.length === 0) return null;

  const latestFile = files[files.length - 1];
  const parsed = JSON.parse(readFileSync(path.join(dir, latestFile), "utf-8"));
  return { report: parsed.report, polledAt: parsed.polled_at };
}

/** Primes the in-memory store from the latest on-disk snapshot for each member,
 * so the UI has data immediately after a backend restart, ahead of the first poll. */
export function hydrateFromDisk(hosts) {
  for (const team of hosts.teams ?? []) {
    for (const member of team.members ?? []) {
      const snapshot = loadLatestReportFromDisk(member.name);
      if (snapshot) {
        state.set(member.name, {
          name: member.name,
          team: team.team,
          status: "online",
          report: snapshot.report,
          error: null,
          lastPolled: snapshot.polledAt,
        });
      }
    }
  }
}

// On a failed poll, `report` is null -- keep the last-known report (with its own
// lastPolled) so a temporarily offline member still contributes historical data
// to team views instead of vanishing.
export function setMemberState(name, team, status, report, error, polledAt) {
  if (status === "online" && report) {
    state.set(name, { name, team, status, report, error, lastPolled: polledAt });
    persistReport(name, report, polledAt);
    return;
  }

  const previous = state.get(name);
  state.set(name, {
    name,
    team,
    status,
    report: previous ? previous.report : null,
    error,
    lastPolled: previous ? previous.lastPolled : polledAt,
  });
}

export function getMemberState(name) {
  return state.get(name) ?? null;
}

export function removeMember(name) {
  state.delete(name);
}

export function getAllState() {
  return Object.fromEntries(state);
}

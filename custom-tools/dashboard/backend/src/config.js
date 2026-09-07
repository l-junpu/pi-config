// Loads the dashboard's config/hosts.json, config/subnet.json, config/server.json.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function dashboardDir() {
  return path.resolve(__dirname, "..", "..");
}

export function configDir() {
  return path.join(dashboardDir(), "config");
}

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function hostsPath() {
  return path.join(configDir(), "hosts.json");
}

export function loadHosts() {
  return loadJson(hostsPath());
}

export function saveHosts(hosts) {
  writeFileSync(hostsPath(), JSON.stringify(hosts, null, 2), "utf-8");
}

export function loadSubnet() {
  return loadJson(path.join(configDir(), "subnet.json"));
}

export function loadServer() {
  return loadJson(path.join(configDir(), "server.json"));
}

/** Yields { team, member } for every member across all teams. */
export function iterMembers(hosts = loadHosts()) {
  const out = [];
  for (const team of hosts.teams ?? []) {
    for (const member of team.members ?? []) {
      out.push({ team: team.team, member });
    }
  }
  return out;
}

/** Returns { team, member } for the given member name, or { team: null, member: null }. */
export function findMember(name, hosts = loadHosts()) {
  for (const entry of iterMembers(hosts)) {
    if (entry.member.name === name) return entry;
  }
  return { team: null, member: null };
}

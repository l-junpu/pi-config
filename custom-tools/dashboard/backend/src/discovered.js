// Persists subnet-sweep results to config/discovered.json. Separate from
// hosts.json -- this just remembers every IP ever found and its editable
// label; promoting one to a team member still goes through hosts.json.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as config from "./config.js";

function discoveredPath() {
  return path.join(config.configDir(), "discovered.json");
}

export function loadDiscovered() {
  const filePath = discoveredPath();
  if (!existsSync(filePath)) return { hosts: [] };
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

export function saveDiscovered(data) {
  writeFileSync(discoveredPath(), JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Merges fresh sweep results into the persisted store. Existing entries keep
 * their `name` untouched (never auto-overwritten); only host/username/last_seen
 * refresh. New IPs are added with `name` defaulted to the /health username.
 */
export function mergeDiscovered(results) {
  const data = loadDiscovered();
  const now = new Date().toISOString();
  const byIp = new Map(data.hosts.map((h) => [h.ip, h]));

  for (const { ip, port, host, username } of results) {
    const existing = byIp.get(ip);
    if (existing) {
      existing.port = port;
      existing.host = host;
      existing.username = username;
      existing.last_seen = now;
    } else {
      // If this IP is already a configured team member, use that member's
      // name instead of the raw /health username, so a manually-added host's
      // first sweep doesn't show a different name than the one already set.
      const configuredMember = config.iterMembers().find((entry) => entry.member.ip === ip)?.member;
      const defaultName = configuredMember?.name ?? username;
      const entry = { ip, port, name: defaultName, host, username, first_seen: now, last_seen: now };
      data.hosts.push(entry);
      byIp.set(ip, entry);
    }
  }

  saveDiscovered(data);
  return data;
}

export function renameDiscovered(ip, name) {
  const data = loadDiscovered();
  const entry = data.hosts.find((h) => h.ip === ip);
  if (!entry) return null;
  entry.name = name;
  saveDiscovered(data);
  return entry;
}

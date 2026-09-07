// Polls teammates' agent.exe /health + /report-json, concurrently, with graceful
// per-host failure handling so one offline machine never blocks the others.

import * as store from "./store.js";

const TIMEOUT_MS = 5000;

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Polls one host and updates the store. Returns a small result summary. */
export async function pollMember(name, team, ip, port) {
  const polledAt = new Date().toISOString();
  const base = `http://${ip}:${port}`;

  try {
    const healthResp = await fetchWithTimeout(`${base}/health`, TIMEOUT_MS);
    if (!healthResp.ok) throw new Error(`health returned ${healthResp.status}`);
  } catch (e) {
    store.setMemberState(name, team, "offline", null, String(e), polledAt);
    return { name, status: "offline", error: String(e) };
  }

  try {
    const reportResp = await fetchWithTimeout(`${base}/report-json`, TIMEOUT_MS);
    if (!reportResp.ok) throw new Error(`report-json returned ${reportResp.status}`);
    const report = await reportResp.json();
    store.setMemberState(name, team, "online", report, null, polledAt);
    return { name, status: "online", error: null };
  } catch (e) {
    store.setMemberState(name, team, "offline", null, String(e), polledAt);
    return { name, status: "offline", error: String(e) };
  }
}

/** entries: array of { team, member }. Polls all of them concurrently. */
export async function pollMembers(entries) {
  return Promise.all(
    entries.map(({ team, member }) =>
      pollMember(member.name, team, member.ip, member.port ?? 8765)
    )
  );
}

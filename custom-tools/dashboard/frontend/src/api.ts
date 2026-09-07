import type {
  MemberReportResponse,
  RefreshResponse,
  Report,
  Team,
  TeamReportResponse,
} from "./types";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail ?? `${url} -> ${res.status}`);
  }
  return res.json();
}

export function getTeams(): Promise<{ teams: Team[] }> {
  return getJson("/api/teams");
}

export function getTeamReport(team: string, range: string): Promise<TeamReportResponse> {
  return getJson(`/api/reports/team/${encodeURIComponent(team)}?range=${range}`);
}

export function getMemberReport(member: string, range: string): Promise<MemberReportResponse> {
  return getJson(`/api/reports?member=${encodeURIComponent(member)}&range=${range}`);
}

export function refreshAll(): Promise<RefreshResponse> {
  return postJson("/api/refresh/all");
}

export function refreshTeam(team: string): Promise<RefreshResponse> {
  return postJson(`/api/refresh/team/${encodeURIComponent(team)}`);
}

export function refreshMember(name: string): Promise<RefreshResponse> {
  return postJson(`/api/refresh/member/${encodeURIComponent(name)}`);
}

export function addTeam(team: string): Promise<{ team: string }> {
  return postJson("/api/teams", { team });
}

export function addMember(team: string, name: string, ip: string, port: number): Promise<unknown> {
  return postJson(`/api/teams/${encodeURIComponent(team)}/members`, { name, ip, port });
}

export async function editMember(team: string, name: string, ip: string, port: number): Promise<unknown> {
  const res = await fetch(`/api/teams/${encodeURIComponent(team)}/members/${encodeURIComponent(name)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ip, port }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail ?? `PATCH member -> ${res.status}`);
  }
  return res.json();
}

export async function deleteMember(team: string, name: string): Promise<void> {
  const res = await fetch(`/api/teams/${encodeURIComponent(team)}/members/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail ?? `DELETE member -> ${res.status}`);
  }
}

export type { Report };

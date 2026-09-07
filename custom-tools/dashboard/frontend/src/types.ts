export type Range = "day" | "week" | "month" | "all";

export type MemberStatus = "online" | "offline" | "unknown";

export interface Member {
  name: string;
  ip: string;
  port: number;
  status: MemberStatus;
  last_polled: string | null;
}

export interface Team {
  team: string;
  members: Member[];
}

export interface ModelStats {
  cost: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  turns: number;
}

export interface Totals {
  cost: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  priced_native_turns: number;
  priced_as_default_turns: number;
  code_lines: number;
  summary_lines: number;
  sessions_scanned: number;
}

export interface Report {
  totals: Totals;
  date_range: { earliest: string | null; latest: string | null };
  by_model: Record<string, ModelStats>;
  by_day: Record<string, { cost: number; code_lines: number; summary_lines: number }>;
  by_week: Record<string, number>;
  by_month: Record<string, number>;
  range?: Range;
}

export interface MemberReportResponse {
  name: string;
  status: MemberStatus;
  error: string | null;
  last_polled: string | null;
  report: Report | null;
}

export interface TeamReportResponse {
  team: string;
  members: { name: string; status: MemberStatus }[];
  report: Report;
}

export interface RefreshResult {
  name: string;
  status: MemberStatus;
  error: string | null;
}

export interface RefreshResponse {
  results: RefreshResult[];
  summary?: string;
}

export interface DiscoveredHost {
  ip: string;
  port: number;
  name: string;
  host: string | null;
  username: string | null;
  first_seen: string;
  last_seen: string;
}

export interface DiscoverResponse {
  hosts: DiscoveredHost[];
  found: number;
}

// Combines one or more members' report-json payloads (see analyze.py's
// generate_report_data) into collated totals, and filters a report by time range.

const RANGES = ["day", "week", "month", "all"];

function emptyTotals() {
  return {
    cost: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    priced_native_turns: 0,
    priced_as_default_turns: 0,
    code_lines: 0,
    summary_lines: 0,
    thinking_lines: 0,
    sessions_scanned: 0,
  };
}

/** Merges multiple report-json objects (one per member) into one collated object. */
export function mergeReports(reports) {
  const totals = emptyTotals();
  const byModel = {};
  const byDay = {};
  const byWeek = {};
  const byMonth = {};
  let earliest = null;
  let latest = null;

  for (const report of reports) {
    if (!report) continue;
    const t = report.totals ?? {};
    for (const key of Object.keys(totals)) {
      totals[key] += t[key] ?? 0;
    }

    for (const [modelKey, stats] of Object.entries(report.by_model ?? {})) {
      const bm = byModel[modelKey] ??= { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
      for (const field of ["cost", "input", "output", "cacheRead", "cacheWrite", "turns"]) {
        bm[field] += stats[field] ?? 0;
      }
    }

    for (const [day, d] of Object.entries(report.by_day ?? {})) {
      const bd = byDay[day] ??= { cost: 0, code_lines: 0, summary_lines: 0, thinking_lines: 0 };
      bd.cost += d.cost ?? 0;
      bd.code_lines += d.code_lines ?? 0;
      bd.summary_lines += d.summary_lines ?? 0;
      bd.thinking_lines += d.thinking_lines ?? 0;
    }

    for (const [week, cost] of Object.entries(report.by_week ?? {})) {
      byWeek[week] = (byWeek[week] ?? 0) + cost;
    }

    for (const [month, cost] of Object.entries(report.by_month ?? {})) {
      byMonth[month] = (byMonth[month] ?? 0) + cost;
    }

    const dr = report.date_range ?? {};
    if (dr.earliest) earliest = earliest === null ? dr.earliest : (dr.earliest < earliest ? dr.earliest : earliest);
    if (dr.latest) latest = latest === null ? dr.latest : (dr.latest > latest ? dr.latest : latest);
  }

  return {
    totals,
    date_range: { earliest, latest },
    by_model: byModel,
    by_day: byDay,
    by_week: byWeek,
    by_month: byMonth,
  };
}

// This server's local calendar date, `daysAgo` days back, as "YYYY-MM-DD".
// Built from plain local getters (no UTC round-tripping via toISOString/
// getTimezoneOffset), so it can't drift by a day depending on the server's
// UTC offset. by_day keys are each report-generating host's own local date
// (see analyze.py's extract_day), so comparing these as plain "YYYY-MM-DD"
// strings is timezone-safe -- no Date-object reparsing involved.
function localDateStr(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Restricts a report to the given range: totals (cost/code/summary/thinking
 * lines) and by_day are both cut down to just the days in range, so the
 * trend chart reflects the selected range (e.g. "week" shows a 7-day graph,
 * not the full all-time history) instead of always rendering every day ever
 * recorded. Other totals fields (tokens, turns, by_model) are all-time only --
 * report-json doesn't break those down per-day, so they're left as-is.
 */
export function filterByRange(report, range) {
  if (!RANGES.includes(range)) {
    throw new Error(`Invalid range: ${range}`);
  }

  const result = { ...report };
  if (range === "all") return result;

  const daysBack = range === "day" ? 0 : range === "week" ? 6 : 29;
  const cutoff = localDateStr(daysBack);

  let filteredCost = 0;
  let filteredCode = 0;
  let filteredSummary = 0;
  let filteredThinking = 0;
  const filteredByDay = {};
  for (const [day, d] of Object.entries(report.by_day ?? {})) {
    if (day === "unknown") continue;
    if (day >= cutoff) {
      filteredCost += d.cost ?? 0;
      filteredCode += d.code_lines ?? 0;
      filteredSummary += d.summary_lines ?? 0;
      filteredThinking += d.thinking_lines ?? 0;
      filteredByDay[day] = d;
    }
  }

  result.totals = { ...(report.totals ?? {}) };
  result.totals.cost = filteredCost;
  result.totals.code_lines = filteredCode;
  result.totals.summary_lines = filteredSummary;
  result.totals.thinking_lines = filteredThinking;
  result.by_day = filteredByDay;
  result.range = range;
  return result;
}

export { RANGES };

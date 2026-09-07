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
      const bd = byDay[day] ??= { cost: 0, code_lines: 0, summary_lines: 0 };
      bd.cost += d.cost ?? 0;
      bd.code_lines += d.code_lines ?? 0;
      bd.summary_lines += d.summary_lines ?? 0;
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

/**
 * Recomputes totals.cost/code_lines/summary_lines restricted to the given range,
 * using by_day (the only granularity we can slice by date). Other totals fields
 * (tokens, turns, by_model) are all-time only -- report-json doesn't break those
 * down per-day, so they're left as-is regardless of range.
 */
export function filterByRange(report, range) {
  if (!RANGES.includes(range)) {
    throw new Error(`Invalid range: ${range}`);
  }

  const result = { ...report };
  if (range === "all") return result;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let cutoff;
  if (range === "day") {
    cutoff = today;
  } else if (range === "week") {
    cutoff = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else {
    cutoff = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  let filteredCost = 0;
  let filteredCode = 0;
  let filteredSummary = 0;
  for (const [day, d] of Object.entries(report.by_day ?? {})) {
    if (day === "unknown") continue;
    const dayDate = new Date(`${day}T00:00:00Z`);
    if (Number.isNaN(dayDate.getTime())) continue;
    if (dayDate >= cutoff) {
      filteredCost += d.cost ?? 0;
      filteredCode += d.code_lines ?? 0;
      filteredSummary += d.summary_lines ?? 0;
    }
  }

  result.totals = { ...(report.totals ?? {}) };
  result.totals.cost = filteredCost;
  result.totals.code_lines = filteredCode;
  result.totals.summary_lines = filteredSummary;
  result.range = range;
  return result;
}

export { RANGES };

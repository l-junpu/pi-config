#!/usr/bin/env python3
"""
Pi Agent cost-analysis tool.

Scans ~/.pi/agent/sessions/<project>/*.jsonl (+ */*-subagents/*.jsonl),
computes per-turn API cost using ~/.pi/agent/models-store.json pricing,
falls back to a configurable "default" model's pricing for local/unpriced
providers, tallies lines-of-code vs lines-of-summary generated, and writes
a standardized Markdown report.

Stdlib only -- safe to freeze with PyInstaller (`pyinstaller --onefile analyze.py`).
"""

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_MODEL_PROVIDER = "anthropic"
DEFAULT_MODEL_ID = "claude-sonnet-5"

# Tool call name patterns used to detect code-writing actions.
WRITE_NAME_HINTS = ("write", "create_file")
EDIT_NAME_HINTS = ("edit", "multiedit", "str_replace")


def home_agent_dir() -> Path:
    return Path.home() / ".pi" / "agent"


def script_dir() -> Path:
    """Directory of the running script, or the .exe itself when frozen by PyInstaller."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def reports_dir() -> Path:
    """cost-analysis/reports -- a sibling of both src/ (dev) and bin/ (frozen exe)."""
    return script_dir().parent / "reports"


def load_json(path: Path):
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_pricing(models_store_path: Path):
    """Return {(provider, model_id): {input, output, cacheRead, cacheWrite}}"""
    store = load_json(models_store_path) or {}
    pricing = {}
    for provider, data in store.items():
        for model in data.get("models", []):
            cost = model.get("cost")
            if cost:
                pricing[(provider, model["id"])] = cost
    return pricing


def find_session_files(sessions_root: Path):
    """Yield (project_dir_name, session_path, is_subagent) for every .jsonl file."""
    if not sessions_root.exists():
        return
    for project_dir in sorted(sessions_root.iterdir()):
        if not project_dir.is_dir():
            continue
        for entry in sorted(project_dir.iterdir()):
            if entry.is_file() and entry.suffix == ".jsonl":
                yield project_dir.name, entry, False
            elif entry.is_dir() and entry.name.endswith("-subagents"):
                for sub_entry in sorted(entry.iterdir()):
                    if sub_entry.is_file() and sub_entry.suffix == ".jsonl":
                        yield project_dir.name, sub_entry, True


def count_lines(text: str) -> int:
    if not text:
        return 0
    # Count newline-separated lines; a trailing newline doesn't add a phantom line.
    return len(text.splitlines())


def extract_code_lines_from_tool_call(name: str, arguments: dict) -> int:
    if not isinstance(arguments, dict):
        return 0
    lname = (name or "").lower()
    lines = 0

    if any(h in lname for h in WRITE_NAME_HINTS):
        content = arguments.get("content")
        if isinstance(content, str):
            lines += count_lines(content)

    if any(h in lname for h in EDIT_NAME_HINTS):
        edits = arguments.get("edits")
        if isinstance(edits, list):
            for e in edits:
                if isinstance(e, dict) and isinstance(e.get("newText"), str):
                    lines += count_lines(e["newText"])
        new_text = arguments.get("newText")
        if isinstance(new_text, str):
            lines += count_lines(new_text)

    return lines


def extract_day(timestamp):
    """Accepts either an epoch-ms int or an ISO-8601 string; returns a date or None."""
    if timestamp is None:
        return None
    if isinstance(timestamp, (int, float)):
        return datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc).date()
    if isinstance(timestamp, str):
        try:
            return datetime.fromisoformat(timestamp.replace("Z", "+00:00")).date()
        except ValueError:
            return None
    return None


def turn_cost(usage: dict, rates: dict) -> float:
    if not usage or not rates:
        return 0.0
    total = 0.0
    for field, rate_key in (
        ("input", "input"),
        ("output", "output"),
        ("cacheRead", "cacheRead"),
        ("cacheWrite", "cacheWrite"),
    ):
        tokens = usage.get(field) or 0
        rate = rates.get(rate_key) or 0
        total += (tokens / 1_000_000) * rate
    return total


def process_session(path: Path, pricing: dict, default_provider: str, default_model: str):
    """Returns per-session aggregate dict."""
    agg = {
        "path": str(path),
        "cost": 0.0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
        "priced_as_default_turns": 0,
        "priced_native_turns": 0,
        "code_lines": 0,
        "summary_lines": 0,
        "models_used": set(),
        "model_stats": defaultdict(lambda: {
            "cost": 0.0, "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "turns": 0
        }),
        "day": None,
    }

    default_rates = pricing.get((default_provider, default_model), {})

    with path.open("r", encoding="utf-8") as f:
        for raw_line in f:
            raw_line = raw_line.strip()
            if not raw_line:
                continue
            try:
                obj = json.loads(raw_line)
            except json.JSONDecodeError:
                continue

            if agg["day"] is None:
                agg["day"] = extract_day(obj.get("timestamp"))

            if obj.get("type") != "message":
                continue
            msg = obj.get("message", {})
            if msg.get("role") != "assistant":
                continue

            if agg["day"] is None:
                agg["day"] = extract_day(msg.get("timestamp"))

            provider = msg.get("provider")
            model = msg.get("model")
            usage = msg.get("usage") or {}

            model_key = f"{provider}/{model}" if provider and model else "unknown/unknown"
            if provider and model:
                agg["models_used"].add(model_key)

            rates = pricing.get((provider, model))
            if rates:
                agg["priced_native_turns"] += 1
            else:
                rates = default_rates
                agg["priced_as_default_turns"] += 1

            cost = turn_cost(usage, rates)
            agg["cost"] += cost
            agg["input_tokens"] += usage.get("input") or 0
            agg["output_tokens"] += usage.get("output") or 0
            agg["cache_read_tokens"] += usage.get("cacheRead") or 0
            agg["cache_write_tokens"] += usage.get("cacheWrite") or 0

            ms = agg["model_stats"][model_key]
            ms["cost"] += cost
            ms["input"] += usage.get("input") or 0
            ms["output"] += usage.get("output") or 0
            ms["cacheRead"] += usage.get("cacheRead") or 0
            ms["cacheWrite"] += usage.get("cacheWrite") or 0
            ms["turns"] += 1

            for block in msg.get("content", []) or []:
                btype = block.get("type")
                if btype == "text":
                    agg["summary_lines"] += count_lines(block.get("text", ""))
                elif btype == "toolCall":
                    agg["code_lines"] += extract_code_lines_from_tool_call(
                        block.get("name", ""), block.get("arguments", {})
                    )

    return agg


def fmt_usd(v: float) -> str:
    return f"${v:,.6f}"


def fmt_int(v: int) -> str:
    return f"{v:,}"


def aggregate_results(results):
    """Pure data aggregation step, shared by the Markdown renderer and the JSON endpoint.

    Returns a dict of plain JSON-serializable data (no defaultdicts/sets).
    """
    by_project = defaultdict(list)
    by_day = defaultdict(lambda: defaultdict(float))
    by_model = defaultdict(lambda: {
        "cost": 0.0, "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "turns": 0
    })

    totals = defaultdict(float)
    total_code_lines = 0
    total_summary_lines = 0
    earliest_day = None
    latest_day = None

    for project, is_subagent, agg in results:
        by_project[project].append((is_subagent, agg))
        totals["cost"] += agg["cost"]
        totals["input_tokens"] += agg["input_tokens"]
        totals["output_tokens"] += agg["output_tokens"]
        totals["cache_read_tokens"] += agg["cache_read_tokens"]
        totals["cache_write_tokens"] += agg["cache_write_tokens"]
        totals["priced_native_turns"] += agg["priced_native_turns"]
        totals["priced_as_default_turns"] += agg["priced_as_default_turns"]
        total_code_lines += agg["code_lines"]
        total_summary_lines += agg["summary_lines"]

        if agg["day"] is not None:
            earliest_day = agg["day"] if earliest_day is None else min(earliest_day, agg["day"])
            latest_day = agg["day"] if latest_day is None else max(latest_day, agg["day"])

        day_key = agg["day"].isoformat() if agg["day"] else "unknown"
        by_day[day_key]["cost"] += agg["cost"]
        by_day[day_key]["code_lines"] += agg["code_lines"]
        by_day[day_key]["summary_lines"] += agg["summary_lines"]

        for model_key, stats in agg["model_stats"].items():
            bm = by_model[model_key]
            bm["cost"] += stats["cost"]
            bm["input"] += stats["input"]
            bm["output"] += stats["output"]
            bm["cacheRead"] += stats["cacheRead"]
            bm["cacheWrite"] += stats["cacheWrite"]
            bm["turns"] += stats["turns"]

    week_totals = defaultdict(float)
    month_totals = defaultdict(float)
    for day, d in by_day.items():
        if day == "unknown":
            continue
        dt = datetime.strptime(day, "%Y-%m-%d")
        week_key = f"{dt.isocalendar()[0]}-W{dt.isocalendar()[1]:02d}"
        month_key = dt.strftime("%Y-%m")
        week_totals[week_key] += d["cost"]
        month_totals[month_key] += d["cost"]

    projects = {}
    for project, entries in by_project.items():
        proj_cost = sum(a["cost"] for _, a in entries)
        proj_code = sum(a["code_lines"] for _, a in entries)
        proj_summary = sum(a["summary_lines"] for _, a in entries)
        sessions = []
        for is_subagent, agg in sorted(entries, key=lambda x: x[1]["path"]):
            sessions.append({
                "session": Path(agg["path"]).name,
                "type": "subagent" if is_subagent else "main",
                "cost": agg["cost"],
                "input_tokens": agg["input_tokens"],
                "output_tokens": agg["output_tokens"],
                "cache_read_tokens": agg["cache_read_tokens"],
                "cache_write_tokens": agg["cache_write_tokens"],
                "models": sorted(agg["models_used"]),
            })
        projects[project] = {
            "cost": proj_cost,
            "code_lines": proj_code,
            "summary_lines": proj_summary,
            "sessions": sessions,
        }

    return {
        "totals": {
            "cost": totals["cost"],
            "input_tokens": int(totals["input_tokens"]),
            "output_tokens": int(totals["output_tokens"]),
            "cache_read_tokens": int(totals["cache_read_tokens"]),
            "cache_write_tokens": int(totals["cache_write_tokens"]),
            "priced_native_turns": int(totals["priced_native_turns"]),
            "priced_as_default_turns": int(totals["priced_as_default_turns"]),
            "code_lines": total_code_lines,
            "summary_lines": total_summary_lines,
            "sessions_scanned": len(results),
        },
        "date_range": {
            "earliest": earliest_day.isoformat() if earliest_day else None,
            "latest": latest_day.isoformat() if latest_day else None,
        },
        "by_model": {k: dict(v) for k, v in by_model.items()},
        "by_day": {k: dict(v) for k, v in by_day.items()},
        "by_week": dict(week_totals),
        "by_month": dict(month_totals),
        "by_project": projects,
    }


def render_markdown(sessions_root, data, default_provider, default_model, generated_at):
    """Renders the Markdown report string from aggregated `data` (see aggregate_results)."""
    totals = data["totals"]
    by_model = data["by_model"]
    by_day = data["by_day"]
    week_totals = data["by_week"]
    month_totals = data["by_month"]
    projects = data["by_project"]
    earliest = data["date_range"]["earliest"]
    latest = data["date_range"]["latest"]

    lines = []
    lines.append(f"# Pi Agent Cost & Activity Report")
    lines.append("")
    lines.append(f"**Generated:** {generated_at.strftime('%Y-%m-%d %H:%M:%S UTC')}  ")
    lines.append(f"**Sessions root:** `{sessions_root}`  ")
    lines.append(f"**Default pricing model (used for local/unpriced providers):** `{default_provider}/{default_model}`")
    lines.append("")
    lines.append("---")
    lines.append("")

    lines.append("## Summary")
    lines.append("")
    lines.append("| Metric | Value |")
    lines.append("|---|---|")
    lines.append(f"| Total cost | **{fmt_usd(totals['cost'])}** |")
    lines.append(f"| Total input tokens | {fmt_int(int(totals['input_tokens']))} |")
    lines.append(f"| Total output tokens | {fmt_int(int(totals['output_tokens']))} |")
    lines.append(f"| Total cache-read tokens | {fmt_int(int(totals['cache_read_tokens']))} |")
    lines.append(f"| Total cache-write tokens | {fmt_int(int(totals['cache_write_tokens']))} |")
    lines.append(f"| Turns priced at native provider rate | {fmt_int(int(totals['priced_native_turns']))} |")
    lines.append(f"| Turns priced at default-model rate (local/unpriced) | {fmt_int(int(totals['priced_as_default_turns']))} |")
    lines.append(f"| Lines of code generated | {fmt_int(totals['code_lines'])} |")
    lines.append(f"| Lines of summary generated | {fmt_int(totals['summary_lines'])} |")
    lines.append(f"| Sessions scanned | {fmt_int(totals['sessions_scanned'])} |")
    date_range = (
        f"{earliest} to {latest}"
        if earliest and latest else "unknown"
    )
    lines.append(f"| Date range covered | {date_range} |")
    lines.append("")

    lines.append("## All-Time Breakdown (by Model)")
    lines.append("")
    lines.append("| Model | Turns | Cost | Input | Output | Cache Read | Cache Write |")
    lines.append("|---|---|---|---|---|---|---|")
    for model_key in sorted(by_model.keys(), key=lambda k: by_model[k]["cost"], reverse=True):
        bm = by_model[model_key]
        lines.append(
            f"| `{model_key}` | {fmt_int(bm['turns'])} | {fmt_usd(bm['cost'])} | "
            f"{fmt_int(bm['input'])} | {fmt_int(bm['output'])} | "
            f"{fmt_int(bm['cacheRead'])} | {fmt_int(bm['cacheWrite'])} |"
        )
    lines.append("")
    lines.append(f"**All-time total cost: {fmt_usd(totals['cost'])}**")
    lines.append("")

    lines.append("## Daily Breakdown")
    lines.append("")
    lines.append("| Day | Cost | Code Lines | Summary Lines |")
    lines.append("|---|---|---|---|")
    for day in sorted(by_day.keys()):
        d = by_day[day]
        lines.append(f"| {day} | {fmt_usd(d['cost'])} | {fmt_int(int(d['code_lines']))} | {fmt_int(int(d['summary_lines']))} |")
    lines.append("")

    lines.append("## Weekly Breakdown")
    lines.append("")
    lines.append("| Week | Cost |")
    lines.append("|---|---|")
    for wk in sorted(week_totals.keys()):
        lines.append(f"| {wk} | {fmt_usd(week_totals[wk])} |")
    lines.append("")

    lines.append("## Monthly Breakdown")
    lines.append("")
    lines.append("| Month | Cost |")
    lines.append("|---|---|")
    for mo in sorted(month_totals.keys()):
        lines.append(f"| {mo} | {fmt_usd(month_totals[mo])} |")
    lines.append("")

    lines.append("## Per-Project Breakdown")
    lines.append("")
    for project in sorted(projects.keys()):
        proj = projects[project]
        sessions = proj["sessions"]
        lines.append(f"### `{project}`")
        lines.append("")
        lines.append(f"- Total cost: **{fmt_usd(proj['cost'])}**")
        lines.append(f"- Lines of code: {fmt_int(proj['code_lines'])}")
        lines.append(f"- Lines of summary: {fmt_int(proj['summary_lines'])}")
        lines.append(f"- Sessions: {fmt_int(len(sessions))}")
        lines.append("")
        lines.append("| Session | Type | Cost | Input | Output | Cache Read | Cache Write | Models |")
        lines.append("|---|---|---|---|---|---|---|---|")
        for s in sessions:
            models = ", ".join(s["models"]) or "-"
            lines.append(
                f"| `{s['session']}` | {s['type']} | {fmt_usd(s['cost'])} | "
                f"{fmt_int(s['input_tokens'])} | {fmt_int(s['output_tokens'])} | "
                f"{fmt_int(s['cache_read_tokens'])} | {fmt_int(s['cache_write_tokens'])} | {models} |"
            )
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("*Report generated by `cost-analysis/analyze.py`. Costs for local/unpriced providers are estimated "
                  f"using `{default_provider}/{default_model}` rates from `models-store.json`.*")
    lines.append("")

    return "\n".join(lines)


def generate_report(agent_dir=None, default_provider=DEFAULT_MODEL_PROVIDER,
                     default_model=DEFAULT_MODEL_ID, output_dir=None):
    """Runs the full scan + report build, writes the .md file, and returns its Path.
    Raises RuntimeError if no session files are found. Importable by agent.py."""
    sessions_root, results = _collect_results(agent_dir, default_provider, default_model)
    output_dir = Path(output_dir) if output_dir else reports_dir()

    generated_at = datetime.now(timezone.utc)
    data = aggregate_results(results)
    report = render_markdown(sessions_root, data, default_provider, default_model, generated_at)

    output_dir.mkdir(parents=True, exist_ok=True)
    report_name = f"report_{generated_at.strftime('%d%b%y').lower()}.md"
    report_path = output_dir / report_name
    report_path.write_text(report, encoding="utf-8")

    return report_path


def _collect_results(agent_dir, default_provider, default_model):
    """Scans session files and returns (sessions_root, results). Raises RuntimeError if empty."""
    agent_dir = Path(agent_dir) if agent_dir else home_agent_dir()
    sessions_root = agent_dir / "sessions"
    models_store_path = agent_dir / "models-store.json"

    pricing = load_pricing(models_store_path)
    if (default_provider, default_model) not in pricing and sys.stderr is not None:
        print(
            f"Warning: default model {default_provider}/{default_model} not found in "
            f"{models_store_path}. Local-model costs will be $0.",
            file=sys.stderr,
        )

    results = []
    for project, path, is_subagent in find_session_files(sessions_root):
        agg = process_session(path, pricing, default_provider, default_model)
        results.append((project, is_subagent, agg))

    if not results:
        raise RuntimeError(f"No session files found under {sessions_root}")

    return sessions_root, results


def generate_report_data(agent_dir=None, default_provider=DEFAULT_MODEL_PROVIDER,
                          default_model=DEFAULT_MODEL_ID):
    """Runs the same scan + aggregation as generate_report(), but returns a JSON-serializable
    dict instead of writing a Markdown file. Used by agent.py's /report-json endpoint.
    Raises RuntimeError if no session files are found."""
    sessions_root, results = _collect_results(agent_dir, default_provider, default_model)
    generated_at = datetime.now(timezone.utc)
    data = aggregate_results(results)
    data["generated_at"] = generated_at.strftime("%Y-%m-%dT%H:%M:%SZ")
    data["sessions_root"] = str(sessions_root)
    data["default_provider"] = default_provider
    data["default_model"] = default_model
    return data


def main():
    parser = argparse.ArgumentParser(description="Pi Agent cost & activity analyzer.")
    parser.add_argument(
        "--agent-dir",
        default=str(home_agent_dir()),
        help="Path to ~/.pi/agent (default: auto-detected from home directory).",
    )
    parser.add_argument(
        "--default-provider",
        default=DEFAULT_MODEL_PROVIDER,
        help=f"Provider used for pricing local/unpriced models (default: {DEFAULT_MODEL_PROVIDER}).",
    )
    parser.add_argument(
        "--default-model",
        default=DEFAULT_MODEL_ID,
        help=f"Model id used for pricing local/unpriced models (default: {DEFAULT_MODEL_ID}).",
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Directory to write the report into (default: this script's directory).",
    )
    args = parser.parse_args()

    try:
        report_path = generate_report(
            agent_dir=args.agent_dir,
            default_provider=args.default_provider,
            default_model=args.default_model,
            output_dir=args.output_dir,
        )
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)

    print(f"Report written to {report_path}")


if __name__ == "__main__":
    main()

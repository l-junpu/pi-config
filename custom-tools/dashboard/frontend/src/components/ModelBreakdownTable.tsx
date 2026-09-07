import { useState } from "react";
import type { ModelStats, Report } from "../types";

interface Props {
  byModel: Report["by_model"];
}

type SortKey = "model" | keyof ModelStats;

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "model", label: "Model" },
  { key: "cost", label: "Cost" },
  { key: "turns", label: "Turns" },
  { key: "input", label: "Input" },
  { key: "output", label: "Output" },
  { key: "cacheRead", label: "Cache Read" },
];

export default function ModelBreakdownTable({ byModel }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("cost");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const rows = Object.entries(byModel).sort((a, b) => {
    const [modelA, statsA] = a;
    const [modelB, statsB] = b;
    const valA = sortKey === "model" ? modelA : statsA[sortKey];
    const valB = sortKey === "model" ? modelB : statsB[sortKey];
    const cmp = typeof valA === "string" ? valA.localeCompare(valB as string) : valA - (valB as number);
    return sortDir === "asc" ? cmp : -cmp;
  });

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  if (rows.length === 0) {
    return (
      <div className="glass" style={{ padding: 24, textAlign: "center" }}>
        <span className="text-dim">No model data yet</span>
      </div>
    );
  }

  return (
    <div className="glass" style={{ padding: 16, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--text-dim)" }}>
            {COLUMNS.map((col) => (
              <th key={col.key} style={{ ...th, cursor: "pointer", userSelect: "none" }} onClick={() => handleSort(col.key)}>
                {col.label}
                {sortKey === col.key && <span style={{ marginLeft: 4 }}>{sortDir === "asc" ? "▲" : "▼"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([model, stats]) => (
            <tr key={model} style={{ borderTop: "1px solid var(--glass-border)" }}>
              <td style={td}>{model}</td>
              <td style={td}>${stats.cost.toFixed(2)}</td>
              <td style={td}>{stats.turns.toLocaleString()}</td>
              <td style={td}>{stats.input.toLocaleString()}</td>
              <td style={td}>{stats.output.toLocaleString()}</td>
              <td style={td}>{stats.cacheRead.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = { padding: "6px 10px", fontWeight: 500 };
const td: React.CSSProperties = { padding: "8px 10px" };

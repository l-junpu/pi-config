import type { Totals } from "../types";

interface Props {
  totals: Totals;
}

export default function CostSummary({ totals }: Props) {
  const cards = [
    { label: "Cost", value: `$${totals.cost.toFixed(2)}` },
    { label: "Sessions", value: totals.sessions_scanned.toLocaleString() },
    { label: "Input Tokens", value: totals.input_tokens.toLocaleString() },
    { label: "Output Tokens", value: totals.output_tokens.toLocaleString() },
    { label: "Cache Read", value: totals.cache_read_tokens.toLocaleString() },
    { label: "Code Lines", value: totals.code_lines.toLocaleString() },
    { label: "Summary Lines", value: totals.summary_lines.toLocaleString() },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
      {cards.map((c) => (
        <div key={c.label} className="glass" style={{ padding: "14px 16px" }}>
          <div className="text-dim" style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: 0.5 }}>
            {c.label}
          </div>
          <div style={{ fontSize: "1.25rem", fontWeight: 600, marginTop: 4 }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

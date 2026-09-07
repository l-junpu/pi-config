import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Report } from "../types";

interface Props {
  byDay: Report["by_day"];
}

export default function CostTrendChart({ byDay }: Props) {
  const data = Object.entries(byDay)
    .filter(([day]) => day !== "unknown")
    .map(([day, d]) => ({ day, cost: Number(d.cost.toFixed(2)) }))
    .sort((a, b) => a.day.localeCompare(b.day));

  if (data.length === 0) {
    return (
      <div className="glass" style={{ padding: 24, textAlign: "center" }}>
        <span className="text-dim">No daily data yet</span>
      </div>
    );
  }

  return (
    <div className="glass" style={{ padding: 20, height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
          <XAxis dataKey="day" stroke="var(--text-dim)" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis
            stroke="var(--text-dim)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={50}
            tickFormatter={(value: number) => value.toFixed(2)}
          />
          <Tooltip
            contentStyle={{
              background: "rgba(20,22,32,0.9)",
              border: "1px solid var(--glass-border)",
              borderRadius: 10,
              color: "var(--text)",
            }}
            formatter={(value) => [`$${Number(value).toFixed(2)}`, "Cost"]}
          />
          <Line type="monotone" dataKey="cost" stroke="var(--accent)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

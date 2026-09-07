import type { Range } from "../types";

const OPTIONS: { value: Range; label: string }[] = [
  { value: "day", label: "Today" },
  { value: "week", label: "7 Days" },
  { value: "month", label: "30 Days" },
  { value: "all", label: "All Time" },
];

interface Props {
  value: Range;
  onChange: (range: Range) => void;
}

export default function RangeSelector({ value, onChange }: Props) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          className="btn"
          style={value === opt.value ? { background: "rgba(255,255,255,0.15)" } : undefined}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

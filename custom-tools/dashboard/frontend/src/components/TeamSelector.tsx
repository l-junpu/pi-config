import type { Team } from "../types";

interface Props {
  teams: Team[];
  selected: string;
  onSelect: (team: string) => void;
  fullWidth?: boolean;
}

export default function TeamSelector({ teams, selected, onSelect, fullWidth }: Props) {
  return (
    <select
      className="glass"
      value={selected}
      onChange={(e) => onSelect(e.target.value)}
      style={{
        padding: "8px 24px 8px 16px",
        fontSize: "0.85rem",
        color: "var(--text)",
        border: "1px solid var(--glass-border)",
        borderRadius: 10,
        width: fullWidth ? "100%" : undefined,
      }}
    >
      {teams.map((t) => (
        <option key={t.team} value={t.team}>
          {t.team}
        </option>
      ))}
    </select>
  );
}

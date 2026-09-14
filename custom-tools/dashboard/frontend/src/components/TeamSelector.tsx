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
        padding: "8px 40px 8px 16px",
        fontSize: "0.85rem",
        color: "var(--text)",
        border: "1px solid var(--glass-border)",
        borderRadius: 10,
        width: fullWidth ? "100%" : undefined,
        appearance: "none",
        WebkitAppearance: "none",
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M2.5 4.5L6 8L9.5 4.5' stroke='%239099ac' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 14px center",
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

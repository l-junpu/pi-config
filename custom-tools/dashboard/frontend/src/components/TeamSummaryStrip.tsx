import type { Member } from "../types";

interface Props {
  members: Member[];
  totalCost: number;
}

export default function TeamSummaryStrip({ members, totalCost }: Props) {
  const online = members.filter((m) => m.status === "online").length;

  return (
    <div className="glass" style={{ display: "flex", gap: 32, padding: "16px 24px" }}>
      <Stat label="Team Cost" value={`$${totalCost.toFixed(2)}`} />
      <Stat label="Members" value={`${members.length}`} />
      <Stat label="Online" value={`${online} / ${members.length}`} accent={online > 0} />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-dim" style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: "1.5rem", fontWeight: 600, color: accent ? "var(--online)" : "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}

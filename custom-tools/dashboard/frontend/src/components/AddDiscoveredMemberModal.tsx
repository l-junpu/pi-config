import { useState } from "react";
import toast from "react-hot-toast";
import * as api from "../api";
import type { DiscoveredHost, Team } from "../types";
import Modal from "./Modal";

interface Props {
  host: DiscoveredHost;
  teams: Team[];
  onClose: () => void;
  onAdded: () => void;
}

export default function AddDiscoveredMemberModal({ host, teams, onClose, onAdded }: Props) {
  const [team, setTeam] = useState(teams[0]?.team ?? "");
  const [name, setName] = useState(host.name);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!team) {
      setError("Select a team");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.addMember(team, name.trim(), host.ip, host.port);
      onAdded();
      onClose();
      toast.success(`Added ${name.trim()} to ${team}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Add ${host.ip} to a Team`} onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <select className="glass" style={inputStyle} value={team} onChange={(e) => setTeam(e.target.value)} required>
          {teams.map((t) => (
            <option key={t.team} value={t.team}>
              {t.team}
            </option>
          ))}
        </select>
        <input
          className="glass"
          style={inputStyle}
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
        />
        <span className="text-dim" style={{ fontSize: "0.8rem" }}>
          {host.ip}:{host.port}
        </span>
        {error && <span style={{ color: "var(--offline)", fontSize: "0.8rem" }}>{error}</span>}
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? "Adding..." : "Add Member"}
        </button>
      </form>
    </Modal>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid var(--glass-border)",
  borderRadius: 10,
  color: "var(--text)",
  fontSize: "0.9rem",
};

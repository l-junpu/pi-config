import { useState } from "react";
import * as api from "../api";
import Modal from "./Modal";

interface Props {
  onClose: () => void;
  onAdded: (team: string) => void;
}

export default function AddTeamModal({ onClose, onAdded }: Props) {
  const [team, setTeam] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.addTeam(team.trim());
      onAdded(team.trim());
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="New Team" onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          className="glass"
          style={inputStyle}
          placeholder="Team name"
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          autoFocus
          required
        />
        {error && <span style={{ color: "var(--offline)", fontSize: "0.8rem" }}>{error}</span>}
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? "Adding..." : "Add Team"}
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

import { useState } from "react";
import toast from "react-hot-toast";
import * as api from "../api";
import type { Team } from "../types";
import Modal from "./Modal";

interface Props {
  team: Team;
  onClose: () => void;
  onDeleted: () => void;
}

// Destructive action -- two-step confirmation before hosts.json is touched:
// step 1 asks for a plain yes/no, step 2 requires typing the team name exactly.
export default function DeleteTeamModal({ team, onClose, onDeleted }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setSubmitting(true);
    setError(null);
    try {
      await api.deleteTeam(team.team);
      onDeleted();
      onClose();
      toast.success(`Deleted team ${team.team}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 1) {
    return (
      <Modal title={`Delete ${team.team}?`} onClose={onClose}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0, fontSize: "0.85rem" }}>
            This permanently removes team <strong>{team.team}</strong> and{" "}
            {team.members.length} member{team.members.length === 1 ? "" : "s"}
            {team.members.length > 0 && (
              <>
                {" "}
                (<span className="text-dim">{team.members.map((m) => m.name).join(", ")}</span>)
              </>
            )}
            . This cannot be undone.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn" style={{ color: "var(--offline)" }} onClick={() => setStep(2)}>
              Continue
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Confirm delete: ${team.team}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ margin: 0, fontSize: "0.85rem" }}>
          Type <strong>{team.team}</strong> to confirm deletion.
        </p>
        <input
          className="glass"
          style={inputStyle}
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          autoFocus
        />
        {error && <span style={{ color: "var(--offline)", fontSize: "0.8rem" }}>{error}</span>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            style={{ color: "var(--offline)" }}
            disabled={confirmText !== team.team || submitting}
            onClick={handleDelete}
          >
            {submitting ? "Deleting..." : "Delete Team"}
          </button>
        </div>
      </div>
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

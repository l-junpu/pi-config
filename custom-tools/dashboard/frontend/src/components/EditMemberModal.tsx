import { useState } from "react";
import * as api from "../api";
import type { Member } from "../types";
import Modal from "./Modal";

interface Props {
  team: string;
  member: Member;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditMemberModal({ team, member, onClose, onSaved }: Props) {
  const [ip, setIp] = useState(member.ip);
  const [port, setPort] = useState(String(member.port));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.editMember(team, member.name, ip.trim(), Number(port));
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Edit ${member.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          className="glass"
          style={inputStyle}
          placeholder="IP address"
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          autoFocus
          required
        />
        <input
          className="glass"
          style={inputStyle}
          placeholder="Port"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          type="number"
        />
        {error && <span style={{ color: "var(--offline)", fontSize: "0.8rem" }}>{error}</span>}
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? "Saving..." : "Save Changes"}
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

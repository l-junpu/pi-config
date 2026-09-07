import { useState } from "react";
import toast from "react-hot-toast";
import * as api from "../api";
import Modal from "./Modal";

interface Props {
  team: string;
  onClose: () => void;
  onAdded: () => void;
}

export default function AddMemberModal({ team, onClose, onAdded }: Props) {
  const [name, setName] = useState("");
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("8765");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.addMember(team, name.trim(), ip.trim(), Number(port));
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
    <Modal title={`Add Member to ${team}`} onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          className="glass"
          style={inputStyle}
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
        />
        <input
          className="glass"
          style={inputStyle}
          placeholder="IP address"
          value={ip}
          onChange={(e) => setIp(e.target.value)}
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

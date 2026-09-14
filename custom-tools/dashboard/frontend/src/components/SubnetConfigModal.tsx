import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import * as api from "../api";
import type { SubnetConfig } from "../types";
import Modal from "./Modal";

interface Props {
  onClose: () => void;
}

// Mirrors backend/src/discovery.js's hostsInCidr (same 1024-host cap) so the form
// can preview a CIDR locally as the user types, without a network round-trip.
function previewCidr(cidr: string): { count: number; first: string; last: string } | null {
  const m = cidr.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  if (!m) return null;
  const octets = m.slice(1, 5).map(Number);
  const prefix = Number(m[5]);
  if (octets.some((o) => o > 255) || prefix > 32) return null;

  const baseInt = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  const hostBits = 32 - prefix;
  const size = 2 ** hostBits;
  if (size > 1024 + 2) return null;

  const networkInt = (baseInt & ((~0 << hostBits) >>> 0)) >>> 0;
  const toIp = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  const start = hostBits <= 1 ? networkInt : networkInt + 1;
  const end = hostBits <= 1 ? networkInt + size - 1 : networkInt + size - 2;
  return { count: end - start + 1, first: toIp(start), last: toIp(end) };
}

export default function SubnetConfigModal({ onClose }: Props) {
  const [current, setCurrent] = useState<SubnetConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [cidr, setCidr] = useState("");
  const [port, setPort] = useState("");
  const [timeoutMs, setTimeoutMs] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSubnet()
      .then((data) => {
        setCurrent(data);
        setCidr(data.cidr);
        setPort(String(data.port));
        setTimeoutMs(String(data.timeout_ms));
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const draftPreview = previewCidr(cidr);

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    try {
      await api.saveSubnet(cidr.trim(), Number(port), Number(timeoutMs));
      toast.success("Subnet config saved");
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Subnet Discovery Settings" onClose={onClose} width={380}>
      {loading && <div className="text-dim">Loading...</div>}

      {!loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div className="text-dim" style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
              Currently configured
            </div>
            <div className="glass" style={{ padding: 12, fontSize: "0.85rem", display: "flex", flexDirection: "column", gap: 2 }}>
              <span>
                {current?.cidr} &middot; port {current?.port} &middot; {current?.timeout_ms}ms timeout
              </span>
              <span className="text-dim">
                {current?.preview
                  ? `${current.preview.count} addresses (${current.preview.first} - ${current.preview.last})`
                  : "Preview unavailable"}
              </span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem" }}>
              CIDR
              <input className="glass" style={inputStyle} value={cidr} onChange={(e) => setCidr(e.target.value)} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem" }}>
              Port
              <input
                className="glass"
                style={inputStyle}
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem" }}>
              Timeout (ms)
              <input
                className="glass"
                style={inputStyle}
                type="number"
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(e.target.value)}
              />
            </label>

            <span className="text-dim" style={{ fontSize: "0.8rem" }}>
              {draftPreview
                ? `Will scan ${draftPreview.count} addresses (${draftPreview.first} - ${draftPreview.last})`
                : "Invalid or too-large CIDR (max 1024 hosts)"}
            </span>
          </div>

          {error && <span style={{ color: "var(--offline)", fontSize: "0.8rem" }}>{error}</span>}

          {!confirming ? (
            <button className="btn btn-primary" disabled={!draftPreview} onClick={() => setConfirming(true)}>
              Save
            </button>
          ) : (
            <div className="glass" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: "0.85rem" }}>
                Save {cidr.trim()} (port {port}, {timeoutMs}ms) as the discovery subnet?
              </span>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary" disabled={submitting} onClick={handleSave}>
                  {submitting ? "Saving..." : "Confirm"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
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

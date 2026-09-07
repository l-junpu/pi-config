import { useState } from "react";
import toast from "react-hot-toast";
import * as api from "../api";
import type { DiscoveredHost } from "../types";

interface Props {
  onDiscovered: (hosts: DiscoveredHost[]) => void;
}

export default function DiscoverButton({ onDiscovered }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [scanning, setScanning] = useState(false);

  async function handleConfirm() {
    setConfirming(false);
    setScanning(true);
    try {
      const res = await api.discoverHosts();
      onDiscovered(res.hosts);
      toast.custom(
        (t) => (
          <div className="glass" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: "0.85rem" }}>
              Sweep complete -- found {res.found} host{res.found === 1 ? "" : "s"}, {res.hosts.length} known total.
            </span>
            <button className="btn" style={{ border: "none", padding: "2px 8px" }} onClick={() => toast.dismiss(t.id)}>
              ✕
            </button>
          </div>
        ),
        { duration: Infinity }
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <button className="btn" disabled={scanning} onClick={() => setConfirming(true)}>
        {scanning ? "Scanning..." : "Discover Hosts"}
      </button>

      {confirming && (
        <div
          className="glass"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            padding: 16,
            width: 240,
            zIndex: 10,
          }}
        >
          <p style={{ margin: "0 0 12px", fontSize: "0.85rem" }}>
            Scan the configured subnet for new hosts? This probes every IP in range.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleConfirm}>
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

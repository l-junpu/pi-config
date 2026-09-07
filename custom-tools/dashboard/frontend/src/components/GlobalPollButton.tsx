import { useState } from "react";

interface Props {
  label: string;
  onConfirm: () => Promise<void>;
}

export default function GlobalPollButton({ label, onConfirm }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [polling, setPolling] = useState(false);

  async function handleConfirm() {
    setConfirming(false);
    setPolling(true);
    try {
      await onConfirm();
    } finally {
      setPolling(false);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <button className="btn btn-primary" disabled={polling} onClick={() => setConfirming(true)}>
        {polling ? "Polling..." : label}
      </button>

      {confirming && (
        <div
          className="glass"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            padding: 16,
            width: 220,
            zIndex: 10,
          }}
        >
          <p style={{ margin: "0 0 12px", fontSize: "0.85rem" }}>Poll now? This contacts hosts over the LAN.</p>
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

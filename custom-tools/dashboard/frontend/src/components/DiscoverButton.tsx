import { useState } from "react";
import toast from "react-hot-toast";
import * as api from "../api";
import { usePopup } from "../PopupContext";
import type { DiscoveredHost } from "../types";

interface Props {
  onDiscovered: (hosts: DiscoveredHost[]) => void;
}

export default function DiscoverButton({ onDiscovered }: Props) {
  const { isOpen: confirming, open: openConfirm, close: closeConfirm } = usePopup("discover");
  const [scanning, setScanning] = useState(false);

  async function handleConfirm() {
    closeConfirm();
    setScanning(true);
    try {
      const res = await api.discoverHosts();
      onDiscovered(res.hosts);
      toast.success(`Sweep complete -- found ${res.found} host${res.found === 1 ? "" : "s"}, ${res.hosts.length} known total.`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <button className="btn" disabled={scanning} onClick={openConfirm}>
        {scanning ? "Scanning..." : "Discover Hosts"}
      </button>

      {confirming && (
        <div
          className="popup"
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
            <button className="btn" onClick={closeConfirm}>
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

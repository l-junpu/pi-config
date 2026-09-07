import { useState } from "react";
import toast from "react-hot-toast";
import * as api from "../api";
import type { DiscoveredHost, Team } from "../types";
import AddDiscoveredMemberModal from "./AddDiscoveredMemberModal";
import Modal from "./Modal";

interface Props {
  hosts: DiscoveredHost[];
  teams: Team[];
  onClose: () => void;
  onRenamed: (host: DiscoveredHost) => void;
  onMemberAdded: () => void;
}

export default function DiscoveredHostsModal({ hosts, teams, onClose, onRenamed, onMemberAdded }: Props) {
  const [editingIp, setEditingIp] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [addingHost, setAddingHost] = useState<DiscoveredHost | null>(null);

  const configuredNameByIp = new Map(teams.flatMap((t) => t.members.map((m) => [m.ip, m.name] as const)));

  function startEdit(host: DiscoveredHost) {
    setEditingIp(host.ip);
    setDraftName(host.name);
  }

  async function saveEdit(host: DiscoveredHost) {
    if (!draftName.trim() || draftName.trim() === host.name) {
      setEditingIp(null);
      return;
    }
    try {
      const updated = await api.renameDiscovered(host.ip, draftName.trim());
      onRenamed(updated);
      toast.success(`Renamed to ${updated.name}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setEditingIp(null);
    }
  }

  return (
    <Modal title="Discovered Hosts" onClose={onClose} width={520}>
      <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
        {hosts.length === 0 && <div className="text-dim">No hosts discovered yet.</div>}

        {hosts.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--glass-border)" }}>
                <th style={{ padding: "6px 4px" }}>Name</th>
                <th style={{ padding: "6px 4px" }}>IP</th>
                <th style={{ padding: "6px 4px" }}>Host / User</th>
                <th style={{ padding: "6px 4px" }}></th>
              </tr>
            </thead>
            <tbody>
              {hosts.map((host) => {
                const configuredName = configuredNameByIp.get(host.ip);
                return (
                <tr key={host.ip} style={{ borderBottom: "1px solid var(--glass-border)" }}>
                  <td style={{ padding: "6px 4px" }}>
                    {configuredName ? (
                      <span title="Managed via team member settings">{configuredName}</span>
                    ) : editingIp === host.ip ? (
                      <input
                        className="glass"
                        autoFocus
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onBlur={() => saveEdit(host)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(host);
                          if (e.key === "Escape") setEditingIp(null);
                        }}
                        style={{ padding: "4px 8px", borderRadius: 8, border: "1px solid var(--glass-border)", width: "100%" }}
                      />
                    ) : (
                      <button
                        className="btn"
                        style={{ border: "none", background: "transparent", padding: "2px 4px", textAlign: "left" }}
                        onClick={() => startEdit(host)}
                        title="Click to rename"
                      >
                        {host.name} ✎
                      </button>
                    )}
                  </td>
                  <td style={{ padding: "6px 4px" }} className="text-dim">
                    {host.ip}:{host.port}
                  </td>
                  <td style={{ padding: "6px 4px" }} className="text-dim">
                    {host.host ?? "?"} / {host.username ?? "?"}
                  </td>
                  <td style={{ padding: "6px 4px", textAlign: "right" }}>
                    {configuredName ? (
                      <span className="text-dim">Configured</span>
                    ) : (
                      <button className="btn" style={{ padding: "4px 8px" }} onClick={() => setAddingHost(host)}>
                        + Add to team
                      </button>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {addingHost && (
        <AddDiscoveredMemberModal
          host={addingHost}
          teams={teams}
          onClose={() => setAddingHost(null)}
          onAdded={onMemberAdded}
        />
      )}
    </Modal>
  );
}

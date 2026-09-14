import { useEffect, useRef, useState } from "react";
import toast, { Toaster } from "react-hot-toast";
import * as api from "./api";
import AddMemberModal from "./components/AddMemberModal";
import AddTeamModal from "./components/AddTeamModal";
import CostSummary from "./components/CostSummary";
import CostTrendChart from "./components/CostTrendChart";
import DeleteTeamModal from "./components/DeleteTeamModal";
import DiscoverButton from "./components/DiscoverButton";
import DiscoveredHostsModal from "./components/DiscoveredHostsModal";
import EditMemberModal from "./components/EditMemberModal";
import GlobalPollButton from "./components/GlobalPollButton";
import MemberList from "./components/MemberList";
import ModelBreakdownTable from "./components/ModelBreakdownTable";
import RangeSelector from "./components/RangeSelector";
import SubnetConfigModal from "./components/SubnetConfigModal";
import TeamSummaryStrip from "./components/TeamSummaryStrip";
import { PopupProvider } from "./PopupContext";
import type { DiscoveredHost, Member, Range, Report, Team } from "./types";

export default function App() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string>("");
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const [range, setRange] = useState<Range>("all");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [discoveredHosts, setDiscoveredHosts] = useState<DiscoveredHost[] | null>(null);
  const [showDeleteTeam, setShowDeleteTeam] = useState(false);
  const [showSubnetConfig, setShowSubnetConfig] = useState(false);

  // Tracked in a ref (not just the `selectedTeam` state closure) so the periodic
  // status-refresh interval below always checks the *current* selection instead
  // of whatever it was when the interval was first set up.
  const selectedTeamRef = useRef(selectedTeam);
  useEffect(() => {
    selectedTeamRef.current = selectedTeam;
  }, [selectedTeam]);

  async function loadTeams() {
    const data = await api.getTeams();
    setTeams(data.teams);
    if (data.teams.length > 0 && !selectedTeamRef.current) {
      setSelectedTeam(data.teams[0].team);
    }
  }

  async function loadReport(silent = false) {
    if (!selectedTeam) return;
    if (!silent) setLoading(true);
    try {
      if (selectedMember) {
        const res = await api.getMemberReport(selectedMember, range);
        setReport(res.report);
      } else {
        const res = await api.getTeamReport(selectedTeam, range);
        setReport(res.report);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadTeams();
    // Refreshes member online/offline status (backend heartbeats every 5s) --
    // without this, the status dot only ever updates after a manual action.
    const interval = setInterval(loadTeams, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    loadReport();
  }, [selectedTeam, selectedMember, range]);

  // The backend re-polls members every poll_interval_seconds (5 min). Refresh the
  // report periodically (silently -- no spinner) so the numbers, especially the
  // "Today" card, update without needing a manual poll or a range/member switch.
  useEffect(() => {
    const interval = setInterval(() => loadReport(true), 30000);
    return () => clearInterval(interval);
  }, [selectedTeam, selectedMember, range]);

  // Tells the backend which team is currently focused, so its health heartbeat
  // loop only pings that team's hosts instead of every configured host.
  useEffect(() => {
    if (selectedTeam) api.setFocusedTeam(selectedTeam).catch(() => {});
  }, [selectedTeam]);

  const currentTeam = teams.find((t) => t.team === selectedTeam);
  const selectedMemberObj = currentTeam?.members.find((m) => m.name === selectedMember) ?? null;

  async function handleDeleteMember(member: Member) {
    if (!confirm(`Remove ${member.name} from ${selectedTeam}?`)) return;
    try {
      await api.deleteMember(selectedTeam, member.name);
      if (selectedMember === member.name) setSelectedMember(null);
      await loadTeams();
      toast.success(`Removed ${member.name}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  function handleTeamDeleted() {
    const remaining = teams.filter((t) => t.team !== selectedTeam);
    setSelectedTeam(remaining[0]?.team ?? "");
    setSelectedMember(null);
  }

  async function handleRefresh() {
    try {
      let response;
      if (selectedMember) {
        response = await api.refreshMember(selectedMember);
      } else if (selectedTeam) {
        response = await api.refreshTeam(selectedTeam);
      }
      await loadTeams();
      await loadReport();

      if (response) {
        if (selectedMember) {
          const result = response.results[0];
          if (result?.status === "online") toast.success(`${selectedMember} updated`);
          else toast.error(`${selectedMember} is offline`);
        } else {
          toast.success(response.summary ?? "Poll complete");
        }
      }
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <PopupProvider>
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 5000,
          style: {
            background: "rgba(15, 17, 26, 0.97)",
            color: "var(--text)",
            border: "1px solid var(--glass-border)",
            borderRadius: 12,
          },
          success: { iconTheme: { primary: "#4ade80", secondary: "rgba(15, 17, 26, 0.97)" } },
          error: { iconTheme: { primary: "#f87171", secondary: "rgba(15, 17, 26, 0.97)" } },
        }}
      />
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Pi Agent Cost Dashboard</h1>
          <span className="text-dim" style={{ fontSize: "0.85rem" }}>LAN-wide usage &amp; cost tracking</span>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button className="btn" onClick={() => setShowAddTeam(true)}>
            + New Team
          </button>
          <button className="btn" onClick={() => setShowSubnetConfig(true)}>
            Subnet Settings
          </button>
          <DiscoverButton onDiscovered={setDiscoveredHosts} />
          <GlobalPollButton label={selectedMember ? `Poll ${selectedMember}` : "Poll Team"} onConfirm={handleRefresh} />
        </div>
      </header>

      {showAddTeam && (
        <AddTeamModal
          onClose={() => setShowAddTeam(false)}
          onAdded={(team) => {
            loadTeams();
            setSelectedTeam(team);
            setSelectedMember(null);
          }}
        />
      )}

      {showAddMember && selectedTeam && (
        <AddMemberModal team={selectedTeam} onClose={() => setShowAddMember(false)} onAdded={loadTeams} />
      )}

      {editingMember && (
        <EditMemberModal
          team={selectedTeam}
          member={editingMember}
          onClose={() => setEditingMember(null)}
          onSaved={loadTeams}
        />
      )}

      {showDeleteTeam && currentTeam && (
        <DeleteTeamModal team={currentTeam} onClose={() => setShowDeleteTeam(false)} onDeleted={handleTeamDeleted} />
      )}

      {showSubnetConfig && <SubnetConfigModal onClose={() => setShowSubnetConfig(false)} />}

      {discoveredHosts && (
        <DiscoveredHostsModal
          hosts={discoveredHosts}
          teams={teams}
          onClose={() => setDiscoveredHosts(null)}
          onRenamed={(host) =>
            setDiscoveredHosts((prev) => prev?.map((h) => (h.ip === host.ip ? host : h)) ?? null)
          }
          onMemberAdded={loadTeams}
        />
      )}

      {currentTeam && <TeamSummaryStrip members={currentTeam.members} totalCost={report?.totals.cost ?? 0} />}

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20, alignItems: "start" }}>
        {currentTeam && (
          <MemberList
            teams={teams}
            selectedTeam={selectedTeam}
            onSelectTeam={setSelectedTeam}
            members={currentTeam.members}
            selected={selectedMember}
            onSelect={setSelectedMember}
            onAddMember={() => setShowAddMember(true)}
            onEditMember={setEditingMember}
            onDeleteMember={handleDeleteMember}
            onDeleteTeam={() => setShowDeleteTeam(true)}
          />
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {selectedMemberObj && (
            <div className="glass" style={{ padding: "8px 14px", display: "flex", alignItems: "center", gap: 10, fontSize: "0.8rem" }}>
              <span className={`status-dot ${selectedMemberObj.status}`} />
              <span style={{ fontWeight: 600 }}>{selectedMemberObj.name}</span>
              <span className="text-dim">{selectedMemberObj.ip}</span>
            </div>
          )}

          <RangeSelector value={range} onChange={setRange} />

          {loading && <div className="text-dim">Loading...</div>}

          {!loading && report && (
            <>
              <CostSummary totals={report.totals} />
              <CostTrendChart byDay={report.by_day} />
              <ModelBreakdownTable byModel={report.by_model} />
            </>
          )}

          {!loading && !report && <div className="text-dim">No data available yet.</div>}
        </div>
      </div>
    </div>
    </PopupProvider>
  );
}

import { useEffect, useState } from "react";
import * as api from "./api";
import AddMemberModal from "./components/AddMemberModal";
import AddTeamModal from "./components/AddTeamModal";
import CostSummary from "./components/CostSummary";
import CostTrendChart from "./components/CostTrendChart";
import EditMemberModal from "./components/EditMemberModal";
import GlobalPollButton from "./components/GlobalPollButton";
import MemberList from "./components/MemberList";
import ModelBreakdownTable from "./components/ModelBreakdownTable";
import RangeSelector from "./components/RangeSelector";
import TeamSummaryStrip from "./components/TeamSummaryStrip";
import type { Member, Range, Report, Team } from "./types";

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

  async function loadTeams() {
    const data = await api.getTeams();
    setTeams(data.teams);
    if (data.teams.length > 0 && !selectedTeam) {
      setSelectedTeam(data.teams[0].team);
    }
  }

  async function loadReport() {
    if (!selectedTeam) return;
    setLoading(true);
    try {
      if (selectedMember) {
        const res = await api.getMemberReport(selectedMember, range);
        setReport(res.report);
      } else {
        const res = await api.getTeamReport(selectedTeam, range);
        setReport(res.report);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTeams();
  }, []);

  useEffect(() => {
    loadReport();
  }, [selectedTeam, selectedMember, range]);

  const currentTeam = teams.find((t) => t.team === selectedTeam);

  async function handleDeleteMember(member: Member) {
    if (!confirm(`Remove ${member.name} from ${selectedTeam}?`)) return;
    await api.deleteMember(selectedTeam, member.name);
    if (selectedMember === member.name) setSelectedMember(null);
    await loadTeams();
  }

  async function handleRefresh() {
    if (selectedMember) {
      await api.refreshMember(selectedMember);
    } else if (selectedTeam) {
      await api.refreshTeam(selectedTeam);
    }
    await loadTeams();
    await loadReport();
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Pi Agent Cost Dashboard</h1>
          <span className="text-dim" style={{ fontSize: "0.85rem" }}>LAN-wide usage &amp; cost tracking</span>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button className="btn" onClick={() => setShowAddTeam(true)}>
            + New Team
          </button>
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
          />
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
  );
}

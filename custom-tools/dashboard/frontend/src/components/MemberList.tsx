import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Member, Team } from "../types";
import TeamSelector from "./TeamSelector";

interface Props {
  teams: Team[];
  selectedTeam: string;
  onSelectTeam: (team: string) => void;
  members: Member[];
  selected: string | null;
  onSelect: (name: string | null) => void;
  onAddMember: () => void;
  onEditMember: (member: Member) => void;
  onDeleteMember: (member: Member) => void;
}

export default function MemberList({
  teams,
  selectedTeam,
  onSelectTeam,
  members,
  selected,
  onSelect,
  onAddMember,
  onEditMember,
  onDeleteMember,
}: Props) {
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);

  return (
    <div className="glass" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ marginBottom: 6 }}>
        <TeamSelector
          teams={teams}
          selected={selectedTeam}
          onSelect={(t) => {
            onSelectTeam(t);
            onSelect(null);
          }}
          fullWidth
        />
      </div>
      <button
        className="btn"
        onClick={() => onSelect(null)}
        style={{
          textAlign: "left",
          border: "none",
          background: selected === null ? "rgba(255,255,255,0.12)" : "transparent",
          fontWeight: 600,
        }}
      >
        Team Overview
      </button>
      {members.map((m) => (
        <MemberRow
          key={m.name}
          member={m}
          active={selected === m.name}
          menuOpen={menuOpenFor === m.name}
          onClick={() => onSelect(m.name)}
          onToggleMenu={() => setMenuOpenFor(menuOpenFor === m.name ? null : m.name)}
          onCloseMenu={() => setMenuOpenFor(null)}
          onEdit={() => {
            setMenuOpenFor(null);
            onEditMember(m);
          }}
          onDelete={() => {
            setMenuOpenFor(null);
            onDeleteMember(m);
          }}
        />
      ))}
      <button className="btn" style={{ textAlign: "left", border: "none", marginTop: 4 }} onClick={onAddMember}>
        + Add Member
      </button>
    </div>
  );
}

function MemberRow({
  member,
  active,
  menuOpen,
  onClick,
  onToggleMenu,
  onCloseMenu,
  onEdit,
  onDelete,
}: {
  member: Member;
  active: boolean;
  menuOpen: boolean;
  onClick: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        borderRadius: 10,
        background: active ? "rgba(255,255,255,0.12)" : "transparent",
      }}
    >
      <button
        className="btn"
        onClick={onClick}
        style={{
          flex: 1,
          textAlign: "left",
          border: "none",
          background: "transparent",
        }}
      >
        <span className={`status-dot ${member.status}`} />
        {member.name}
      </button>
      <button
        ref={menuBtnRef}
        className="btn"
        onClick={onToggleMenu}
        style={{ border: "none", padding: "4px 8px", background: "transparent" }}
        aria-label="Member actions"
      >
        ⋮
      </button>

      {menuOpen && menuBtnRef.current &&
        createPortal(
          <MemberMenuPortal anchor={menuBtnRef.current} onClose={onCloseMenu} onEdit={onEdit} onDelete={onDelete} />,
          document.body
        )}
    </div>
  );
}

function MemberMenuPortal({
  anchor,
  onClose,
  onEdit,
  onDelete,
}: {
  anchor: HTMLButtonElement;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const rect = anchor.getBoundingClientRect();

  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 999 }} onClick={onClose} />
      <div
        style={{
          position: "fixed",
          top: rect.top,
          left: rect.right + 6,
          zIndex: 1000,
          padding: 6,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          minWidth: 100,
          background: "rgba(18,20,30,0.98)",
          border: "1px solid var(--glass-border)",
          borderRadius: 10,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        <button className="btn" style={{ border: "none", textAlign: "left", background: "transparent" }} onClick={onEdit}>
          Edit
        </button>
        <button
          className="btn"
          style={{ border: "none", textAlign: "left", background: "transparent", color: "var(--offline)" }}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </>
  );
}

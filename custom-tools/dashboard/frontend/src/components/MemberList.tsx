import { useRef } from "react";
import { createPortal } from "react-dom";
import { usePopup } from "../PopupContext";
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
          onClick={() => onSelect(m.name)}
          onEdit={() => onEditMember(m)}
          onDelete={() => onDeleteMember(m)}
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
  onClick,
  onEdit,
  onDelete,
}: {
  member: Member;
  active: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { isOpen: menuOpen, toggle: toggleMenu, close: closeMenu } = usePopup(`member-menu-${member.name}`);
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
        onClick={toggleMenu}
        style={{ border: "none", padding: "4px 10px", marginRight: 4 }}
        aria-label="Member actions"
      >
        ⋮
      </button>

      {menuOpen && menuBtnRef.current &&
        createPortal(
          <MemberMenuPortal anchor={menuBtnRef.current} onClose={closeMenu} onEdit={onEdit} onDelete={onDelete} />,
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
        className="popup"
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
        }}
      >
        <button
          className="menu-item"
          onClick={() => {
            onClose();
            onEdit();
          }}
        >
          Edit
        </button>
        <button
          className="menu-item"
          style={{ color: "var(--offline)" }}
          onClick={() => {
            onClose();
            onDelete();
          }}
        >
          Delete
        </button>
      </div>
    </>
  );
}

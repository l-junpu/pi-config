import { createContext, useContext, useState, type ReactNode } from "react";

interface PopupContextValue {
  openId: string | null;
  setOpenId: (id: string | null) => void;
}

const PopupContext = createContext<PopupContextValue | null>(null);

export function PopupProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return <PopupContext.Provider value={{ openId, setOpenId }}>{children}</PopupContext.Provider>;
}

/** Ensures only one anchored popover (confirm dialogs, dropdown menus) is open at a time. */
export function usePopup(id: string) {
  const ctx = useContext(PopupContext);
  if (!ctx) throw new Error("usePopup must be used within a PopupProvider");
  const isOpen = ctx.openId === id;
  return {
    isOpen,
    open: () => ctx.setOpenId(id),
    close: () => ctx.setOpenId(null),
    toggle: () => ctx.setOpenId(isOpen ? null : id),
  };
}

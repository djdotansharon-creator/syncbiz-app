"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type MobileRole = "controller" | "player";

const STORAGE_KEY = "syncbiz-mobile-role";

type MobileRoleContextValue = {
  mobileRole: MobileRole;
  setMobileRole: (role: MobileRole) => void;
};

const MobileRoleContext = createContext<MobileRoleContextValue | null>(null);

function getStoredRole(): MobileRole {
  if (typeof window === "undefined") return "controller";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "player" || stored === "controller") return stored;
  } catch {
    /* ignore */
  }
  return "controller";
}

export function MobileRoleProvider({ children }: { children: ReactNode }) {
  const [mobileRole, setMobileRoleState] = useState<MobileRole>("controller");

  useEffect(() => {
    setMobileRoleState(getStoredRole());
  }, []);

  const setMobileRole = useCallback((role: MobileRole) => {
    setMobileRoleState(role);
    try {
      localStorage.setItem(STORAGE_KEY, role);
    } catch {
      /* ignore */
    }
  }, []);

  const value = { mobileRole, setMobileRole };

  return (
    <MobileRoleContext.Provider value={value}>
      {children}
    </MobileRoleContext.Provider>
  );
}

export function useMobileRole() {
  const ctx = useContext(MobileRoleContext);
  return ctx ?? { mobileRole: "controller" as MobileRole, setMobileRole: () => {} };
}

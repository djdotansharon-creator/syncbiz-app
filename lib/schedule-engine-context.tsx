"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "syncbiz-schedule-engine-enabled";

type Ctx = {
  /** When false, automatic schedule playback does not run in this browser. */
  engineEnabled: boolean;
  setEngineEnabled: (v: boolean) => void;
};

const ScheduleEngineContext = createContext<Ctx | null>(null);

function readStored(): boolean {
  if (typeof window === "undefined") return true;
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === null) return true;
  return v === "true";
}

export function ScheduleEngineProvider({ children }: { children: ReactNode }) {
  const [engineEnabled, setEngineState] = useState(true);

  useEffect(() => {
    setEngineState(readStored());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue !== null) {
        setEngineState(e.newValue === "true");
      }
    };
    const onCustom = () => setEngineState(readStored());
    window.addEventListener("storage", onStorage);
    window.addEventListener("syncbiz-schedule-engine", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("syncbiz-schedule-engine", onCustom);
    };
  }, []);

  const setEngineEnabled = useCallback((v: boolean) => {
    localStorage.setItem(STORAGE_KEY, String(v));
    setEngineState(v);
    window.dispatchEvent(new Event("syncbiz-schedule-engine"));
  }, []);

  const value = useMemo(
    () => ({ engineEnabled, setEngineEnabled }),
    [engineEnabled, setEngineEnabled],
  );

  return (
    <ScheduleEngineContext.Provider value={value}>{children}</ScheduleEngineContext.Provider>
  );
}

export function useScheduleEngine(): Ctx {
  const ctx = useContext(ScheduleEngineContext);
  if (!ctx) {
    throw new Error("useScheduleEngine must be used within ScheduleEngineProvider");
  }
  return ctx;
}

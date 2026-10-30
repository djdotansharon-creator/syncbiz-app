"use client";

/**
 * SettingsTabs — Settings with tabs (owner 2026-10-31: "move the Owner tab into the tabs of More settings, and the remote control too, and arrange the settings clearly"). The old "Owner" top tab is gone: its two pages
 * live here — "Business" (the workspace profile) and "Remote control" (control a branch's player) — next to "Settings" (this device). A manager sees all three, everyone else only "Settings" (no tab bar). Only the open
 * tab is mounted, so the remote-control socket does not connect until that tab is opened. The open tab is kept in the address (?tab=) so /owner can send people straight to the right one.
 */

import { useCallback, useState, type ReactNode } from "react";
import { useTr } from "@/lib/i18n/use-tr";

type Tab = "general" | "business" | "remote";

export function SettingsTabs({ general, business, remote, initial }: { general: ReactNode; business?: ReactNode; remote?: ReactNode; initial?: string }) {
  const tr = useTr();
  const has = (t: Tab) => (t === "general" ? true : t === "business" ? !!business : !!remote);
  const start = (["general", "business", "remote"] as Tab[]).find((t) => t === initial && has(t)) ?? "general";
  const [tab, setTab] = useState<Tab>(start);
  const pick = useCallback((t: Tab) => {
    setTab(t);
    try {
      const u = new URL(window.location.href);
      if (t === "general") u.searchParams.delete("tab");
      else u.searchParams.set("tab", t);
      window.history.replaceState(null, "", u.toString());
    } catch {
      /* the tab still switches */
    }
  }, []);
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "general", label: tr("This device") },
    ...(business ? [{ id: "business" as Tab, label: tr("Business") }] : []),
    ...(remote ? [{ id: "remote" as Tab, label: tr("Remote control") }] : []),
  ];
  return (
    <>
      {tabs.length > 1 ? (
        <div className="sb-set-tabs" role="tablist" aria-label={tr("Settings")}>
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="sb-set-tab" onClick={() => pick(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      ) : null}
      {tab === "general" ? general : tab === "business" ? business : remote}
    </>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useTr } from "@/lib/i18n/use-tr";
import { useVmUi } from "@/components/vm/vm-ui";
import { IconCalendar } from "@/components/vm/vm-icons";

/**
 * A BRANCH'S SCHEDULE ON / OFF — kept with the branch on the server (/api/schedules/switch); whoever may edit the branch's schedules flips it, from anywhere, and the branch's
 * player obeys. Shared by the branch screen and Today's plan.
 */
type SwitchState = { enabled: boolean; switchable: boolean };

export function useScheduleSwitch(branchId: string | null) {
  const [sw, setSw] = useState<(SwitchState & { branch: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!branchId) return;
    let off = false;
    const read = () =>
      fetch(`/api/schedules/switch?branchId=${encodeURIComponent(branchId)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { enabled?: boolean; switchable?: boolean } | null) => {
          if (!off && j && typeof j.enabled === "boolean") setSw({ branch: branchId, enabled: j.enabled, switchable: j.switchable !== false });
        })
        .catch(() => undefined);
    void read();
    const id = window.setInterval(read, 30_000); // another manager may flip it
    const onVisible = () => document.visibilityState === "visible" && void read();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      off = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [branchId]);
  const flip = useCallback(
    async (onFail: () => void) => {
      if (!branchId || !sw || sw.branch !== branchId || busy || !sw.switchable) return;
      const next = !sw.enabled;
      setSw({ ...sw, enabled: next }); // shown at once, confirmed by the server (a failure puts it back)
      setBusy(true);
      try {
        const r = await fetch("/api/schedules/switch", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branchId, enabled: next }) });
        if (!r.ok) throw new Error(String(r.status));
      } catch {
        setSw((cur) => (cur ? { ...cur, enabled: !next } : cur));
        onFail();
      } finally {
        setBusy(false);
      }
    },
    [branchId, sw, busy],
  );
  return { sw: sw && sw.branch === branchId ? sw : null, busy, flip };
}

/** the "Schedule — on / off" line (a `.vm-line`: it sits in a `.vm-group` on the branch screen, alone on Today's plan) */
export function VmScheduleSwitchLine({ branchId, title }: { branchId: string | null; /** the line's name (default "Schedule") — the branch's schedule screen already has that as its heading */ title?: string }) {
  const tr = useTr();
  const ui = useVmUi();
  const { sw, busy, flip } = useScheduleSwitch(branchId);
  return (
    <button
      type="button"
      className="vm-line"
      onClick={() => void flip(() => ui.toast(tr("Couldn't change the schedule. Try again.")))}
      disabled={!sw || !sw.switchable}
      role="switch"
      aria-checked={!!sw?.enabled}
    >
      <IconCalendar />
      <span className="vm-line-text">
        {title ?? tr("Schedule")}
        <small>{!sw ? "…" : !sw.switchable ? tr("Not available for this branch") : sw.enabled ? tr("On — the branch follows its day plan") : tr("Off — nothing starts by itself")}</small>
      </span>
      <span className="vm-switch" data-on={sw?.enabled ? "" : undefined} data-busy={busy ? "" : undefined} />
    </button>
  );
}

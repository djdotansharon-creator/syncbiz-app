"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useMobileFleet } from "@/lib/mobile-fleet";
import { useTr } from "@/lib/i18n/use-tr";
import { VmPage, useVmUi } from "@/components/vm/vm-ui";
import { VmNowPlaying } from "@/components/vm/vm-now-playing";
import { IconCalendar, IconChevronBack, IconChevronForward, IconJingle, IconLibrary, IconStore, IconUpNext } from "@/components/vm/vm-icons";

/**
 * ONE BRANCH — the control surface of a business location: what it plays now (cover, position, volume, modes, what is next) and the
 * branch's own tools (its schedule on / off, jingles, pick something to play). Opening it makes this branch the one the whole app controls.
 */

type SwitchState = { enabled: boolean; switchable: boolean };

function useScheduleSwitch(branchId: string | null) {
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

export default function MobileBranchPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ""));
  const f = useMobileFleet();
  const tr = useTr();
  const ui = useVmUi();
  const branch = f.branches.find((b) => b.id === id) ?? null;

  // opening a branch makes it THE branch the whole app (mini-player, library, search) controls
  const { select } = f;
  useEffect(() => {
    if (branch) select(branch.id);
  }, [branch, select]);

  const { sw, busy, flip } = useScheduleSwitch(branch?.id ?? null);

  const back = (
    <Link href="/mobile/home" className="vm-icobtn vm-back" aria-label={tr("Branches")}>
      <IconChevronBack />
      <span>{tr("Branches")}</span>
    </Link>
  );

  if (f.loaded && !branch) {
    return (
      <VmPage title={tr("Branch")} lead={back}>
        <div className="vm-empty">
          <IconStore />
          <h2>{tr("This branch isn't available")}</h2>
          <span>{tr("It may have been removed, or you may not have access to it.")}</span>
        </div>
      </VmPage>
    );
  }

  return (
    <VmPage title={branch?.name ?? ""} barTitle={branch?.name} lead={back} subtitle={branch?.city || undefined}>
      <VmNowPlaying hideWho />

      <div className="vm-group">
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
            {tr("Schedule")}
            <small>{!sw ? "…" : !sw.switchable ? tr("Not available for this branch") : sw.enabled ? tr("On — the branch follows its day plan") : tr("Off — nothing starts by itself")}</small>
          </span>
          <span className="vm-switch" data-on={sw?.enabled ? "" : undefined} data-busy={busy ? "" : undefined} />
        </button>
        <Link href="/mobile/scheduling" className="vm-line">
          <IconUpNext />
          <span className="vm-line-text">{tr("Today's plan")}</span>
          <IconChevronForward className="vm-chev vm-flip" />
        </Link>
        <Link href="/mobile/jingles" className="vm-line">
          <IconJingle />
          <span className="vm-line-text">{tr("Jingles")}</span>
          <IconChevronForward className="vm-chev vm-flip" />
        </Link>
        <Link href="/mobile/library" className="vm-line">
          <IconLibrary />
          <span className="vm-line-text">{tr("Pick something to play")}</span>
          <IconChevronForward className="vm-chev vm-flip" />
        </Link>
      </div>
    </VmPage>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

type Ws = { id: string; name: string };

type Props = {
  workspaces: Ws[];
  activeId: string;
  /** If only one workspace, still show name as static text (optional) */
  variant?: "compact";
};

/**
 * Stage 8 — switch active workspace (HttpOnly cookie via POST /api/auth/active-workspace).
 * Hidden when the user has fewer than two eligible workspaces.
 */
export function WorkspaceSwitcher({ workspaces, activeId, variant = "compact" }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onChange = useCallback(
    async (nextId: string) => {
      if (nextId === activeId || !nextId || busy) return;
      setBusy(true);
      setErr(null);
      try {
        const res = await fetch("/api/auth/active-workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: nextId }),
        });
        if (!res.ok) {
          setErr("Could not switch");
          return;
        }
        router.refresh();
      } catch {
        setErr("Could not switch");
      } finally {
        setBusy(false);
      }
    },
    [activeId, busy, router],
  );

  if (workspaces.length < 2) return null;

  const cls =
    variant === "compact"
      ? "max-w-[10rem] truncate rounded border border-slate-700/80 bg-slate-900/90 px-2 py-0.5 text-[11px] font-medium text-slate-200 outline-none focus:ring-2 focus:ring-cyan-500/30"
      : "rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm";

  return (
    <span className="inline-flex min-w-0 max-w-full shrink items-center gap-1">
      <label className="sr-only" htmlFor="syncbiz-active-workspace">
        Workspace
      </label>
      <select
        id="syncbiz-active-workspace"
        className={cls}
        disabled={busy}
        value={activeId}
        title="Active workspace"
        onChange={(e) => onChange(e.target.value)}
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name || w.id.slice(0, 8)}
          </option>
        ))}
      </select>
      {err ? <span className="sr-only">{err}</span> : null}
    </span>
  );
}

"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import type { UnifiedSource } from "@/lib/source-types";

/**
 * `SourcesManager` must not SSR: it uses `usePlayback` from the root `PlaybackProvider`, so it is loaded on the client.
 *
 * SELF-HEALING LOAD (owner 2026-10-15 — branch stations stayed on "Loading…" for hours): the library is the main
 * screen and must ALWAYS come up, with no button and no user action.
 *  - Loaded with a plain effect + import() + setState (NOT next/dynamic → React.lazy + Suspense): a resolved module
 *    commits as a normal update, so a busy station (status updates several times a second) cannot starve it.
 *  - A failed import retries by itself (1 s, 2 s, 4 s, 8 s …).
 *  - Still not mounted after LOAD_DEADLINE_MS (a hung chunk never resolves) → the page reloads itself, at most once per
 *    RELOAD_COOLDOWN_MS (per window — no reload loop). Audio is never affected: on a station it plays in the desktop
 *    player (MAIN), not in this page.
 *  - Every failure is logged (on the desktop app it lands in main.log) so the cause is always visible.
 */
const LOAD_DEADLINE_MS = 25_000;
const RELOAD_COOLDOWN_MS = 10 * 60 * 1000;
const RELOAD_KEY = "vono-library-autoreload-at";

export type SourcesManagerClientProps = {
  initialSources: UnifiedSource[];
  pageTitle?: string;
  pageSubtitle?: string;
  playerWorkspaceMode?: boolean;
  workspaceRouteCenter?: ReactNode;
};

type ManagerComponent = ComponentType<SourcesManagerClientProps>;

export function SourcesManagerClient(props: SourcesManagerClientProps) {
  const [Manager, setManager] = useState<ManagerComponent | null>(null);

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let deadline: ReturnType<typeof setTimeout> | null = null;

    const load = () => {
      attempt += 1;
      import("@/components/sources-manager")
        .then((m) => {
          if (cancelled) return;
          if (deadline) clearTimeout(deadline); // loaded → never auto-reload
          setManager(() => m.SourcesManager as ManagerComponent);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          console.error("[VONO library] load failed — retrying", { attempt, error: String(err) });
          retryTimer = setTimeout(load, Math.min(1000 * 2 ** (attempt - 1), 15_000));
        });
    };
    load();

    // last resort: a chunk that never settles cannot be retried in place → reload this page (rate-limited)
    deadline = setTimeout(() => {
      if (cancelled) return;
      let last = 0;
      try { last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) || 0; } catch { /* ignore */ }
      if (Date.now() - last < RELOAD_COOLDOWN_MS) {
        console.error("[VONO library] still loading after deadline; auto-reload already used recently — waiting", { attempt });
        return;
      }
      try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* ignore */ }
      console.error("[VONO library] still loading after deadline — reloading the page", { attempt, ms: LOAD_DEADLINE_MS });
      window.location.reload();
    }, LOAD_DEADLINE_MS);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (deadline) clearTimeout(deadline);
    };
  }, []);

  if (!Manager) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-12 text-center text-slate-500" aria-busy="true">Loading…</div>
    );
  }
  return <Manager {...props} />;
}

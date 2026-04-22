"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMobileRole } from "@/lib/mobile-role-context";
import { usePlayback } from "@/lib/playback-provider";
import { fetchUnifiedSourcesWithFallback } from "@/lib/unified-sources-client";
import { resolveMobileUnifiedScope } from "@/lib/content-scope-resolution";
import type { ApiContentScope } from "@/lib/content-scope-filters";
import type { AccessType } from "@/lib/user-types";
import type { UnifiedSource } from "@/lib/source-types";

type LoadState = "idle" | "loading" | "ready" | "error";

type MobileSourcesContextValue = {
  sources: UnifiedSource[];
  status: LoadState;
  error: string | null;
  contentScope: ApiContentScope;
  /** Force a reload. */
  reload: () => void;
  /** Optimistic add – used by search "+ add" flow. */
  addSource: (source: UnifiedSource) => void;
  /** Swap a temp optimistic source with the real one returned by the API. */
  replaceSource: (tempId: string, real: UnifiedSource) => void;
  /** Optimistic remove. */
  removeSource: (id: string, origin?: UnifiedSource["origin"]) => void;
};

const MobileSourcesContext = createContext<MobileSourcesContextValue | null>(null);

/**
 * Loads the user's unified sources (playlists, radios, etc.) once per mount and exposes a
 * shared state to every mobile tab.
 *
 * Reload policy:
 * - Reloads when mobileRole flips (Controller vs Player may have different scopes in the future).
 * - Reloads on explicit `reload()` from tab pages (e.g. after a save/delete).
 * - Does NOT reload on tab navigation — the same data is reused across Home / Search / Library.
 *
 * OWNER users get the merged `owner_personal` + `branch` catalog so their personal bank is visible
 * alongside the shared station library (matching the prior behavior of the monolithic mobile page).
 */
export function MobileSourcesProvider({ children }: { children: ReactNode }) {
  const { mobileRole } = useMobileRole();
  const { setQueue, replaceSource: providerReplaceSource, queue } = usePlayback();

  const [sources, setSources] = useState<UnifiedSource[]>([]);
  const [status, setStatus] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [contentScope, setContentScope] = useState<ApiContentScope>("branch");
  const [reloadTick, setReloadTick] = useState(0);

  const queueRef = useRef(queue);
  queueRef.current = queue;

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);

    (async () => {
      try {
        const me = await fetch("/api/auth/me", { credentials: "include" }).then((r) => r.json());
        const accessType = (me?.accessType === "OWNER" || me?.accessType === "BRANCH_USER"
          ? me.accessType
          : "BRANCH_USER") as AccessType;
        const scope = resolveMobileUnifiedScope(
          accessType,
          mobileRole === "controller" ? "controller" : "player",
        );

        let items: UnifiedSource[];
        if (accessType === "OWNER" && mobileRole !== "controller") {
          const [personal, branch] = await Promise.all([
            fetchUnifiedSourcesWithFallback({ scope: "owner_personal" }),
            fetchUnifiedSourcesWithFallback({ scope: "branch" }),
          ]);
          const seen = new Set<string>();
          items = [...personal, ...branch].filter((s) => {
            if (seen.has(s.id)) return false;
            seen.add(s.id);
            return true;
          });
        } else {
          items = await fetchUnifiedSourcesWithFallback({ scope });
        }

        if (cancelled) return;
        setContentScope(scope);
        setSources(items);
        // Mobile queue intentionally excludes radio: radio is not part of the mobile IA.
        // Desktop still queues radio separately via its own library code paths.
        const forQueue = items.filter((s) => s.origin === "playlist");
        setQueue(forQueue);
        setStatus("ready");
      } catch {
        if (cancelled) return;
        setError("Failed to load library");
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mobileRole, reloadTick, setQueue]);

  const reload = useCallback(() => setReloadTick((n) => n + 1), []);

  const addSource = useCallback(
    (source: UnifiedSource) => {
      setSources((prev) => {
        if (prev.some((s) => s.id === source.id)) return prev;
        return [source, ...prev];
      });
      const merged = [source, ...queueRef.current].filter(
        (s, i, arr) => arr.findIndex((x) => x.id === s.id) === i,
      );
      setQueue(merged);
    },
    [setQueue],
  );

  const replaceSource = useCallback(
    (tempId: string, real: UnifiedSource) => {
      setSources((prev) => prev.map((s) => (s.id === tempId ? real : s)));
      providerReplaceSource(tempId, real);
    },
    [providerReplaceSource],
  );

  const removeSource = useCallback(
    (id: string, origin?: UnifiedSource["origin"]) => {
      setSources((prev) => prev.filter((s) => s.id !== id));
      if (origin === "playlist") {
        void import("@/lib/unified-sources-client").then(({ removePlaylistFromLocal }) =>
          removePlaylistFromLocal(id),
        );
      } else if (origin === "radio") {
        void import("@/lib/unified-sources-client").then(({ removeRadioFromLocal }) =>
          removeRadioFromLocal(id),
        );
      }
      reload();
    },
    [reload],
  );

  return (
    <MobileSourcesContext.Provider
      value={{
        sources,
        status,
        error,
        contentScope,
        reload,
        addSource,
        replaceSource,
        removeSource,
      }}
    >
      {children}
    </MobileSourcesContext.Provider>
  );
}

export function useMobileSources(): MobileSourcesContextValue {
  const ctx = useContext(MobileSourcesContext);
  if (!ctx) {
    throw new Error("useMobileSources must be used inside MobileSourcesProvider (app/(app)/mobile/layout.tsx)");
  }
  return ctx;
}

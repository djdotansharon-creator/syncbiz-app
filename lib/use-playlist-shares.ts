"use client";

/**
 * The playlist shares of THIS window's branch (owner 2026-11-22, sharing phase C): what waits for an answer and what was accepted (live). Reads /api/playlist-shares for the branch, refreshes when the
 * library says it changed (the share arrives through the same LIBRARY_UPDATED the server sends), when the window gets focus, and once a minute while it is visible. `branchId` null = a branch that cannot
 * receive shares (no real branch) → nothing is asked. A newly arrived request raises the toast once.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Playlist } from "@/lib/playlist-types";

export type ShareStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "REVOKED";
export type ShareView = {
  id: string;
  playlistId: string;
  targetBranchId: string;
  status: ShareStatus;
  createdAt: string;
  decidedAt: string | null;
  fromUserId: string;
  fromName: string | null;
  playlist: Playlist | null;
};
export type ShareAnswer = "accept" | "decline" | "copy" | "revoke" | "leave";
export type ShareAnswerResult = { ok: true; copy: Playlist | null } | { ok: false; error: string };

export function usePlaylistShares(branchId: string | null, newRequestMessage: (n: number) => string): {
  pending: ShareView[];
  accepted: ShareView[];
  loaded: boolean;
  reload: () => void;
  answer: (id: string, action: ShareAnswer, name?: string) => Promise<ShareAnswerResult>;
} {
  const [pending, setPending] = useState<ShareView[]>([]);
  const [accepted, setAccepted] = useState<ShareView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  const seen = useRef<Set<string> | null>(null);
  const msgRef = useRef(newRequestMessage);
  msgRef.current = newRequestMessage; // eslint-disable-line react-hooks/refs

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!branchId) return;
    let off = false;
    fetch(`/api/playlist-shares?status=all&branchId=${encodeURIComponent(branchId)}`, { cache: "no-store", credentials: "include" })
      .then((r) => (r.ok ? (r.json() as Promise<ShareView[]>) : null))
      .then((list) => {
        if (off || !Array.isArray(list)) return; // a failed read keeps what is on screen
        const pend = list.filter((s) => s.status === "PENDING" && s.playlist);
        setPending(pend);
        setAccepted(list.filter((s) => s.status === "ACCEPTED" && s.playlist));
        setLoaded(true);
        const ids = new Set(pend.map((s) => s.id));
        if (seen.current) {
          const fresh = pend.filter((s) => !seen.current!.has(s.id)).length;
          if (fresh > 0) window.dispatchEvent(new CustomEvent("syncbiz:toast", { detail: { message: msgRef.current(fresh) } }));
        }
        seen.current = ids;
      })
      .catch(() => {
        /* offline — keep what is on screen */
      });
    return () => {
      off = true;
    };
  }, [branchId, tick]);

  useEffect(() => {
    if (!branchId) return;
    const again = () => reload();
    const visibleAgain = () => {
      if (document.visibilityState === "visible") reload();
    };
    window.addEventListener("library-updated", again);
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", visibleAgain);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 60_000);
    return () => {
      window.removeEventListener("library-updated", again);
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", visibleAgain);
      clearInterval(timer);
    };
  }, [branchId, reload]);

  const answer = useCallback(
    async (id: string, action: ShareAnswer, name?: string): Promise<ShareAnswerResult> => {
      try {
        const r = await fetch(`/api/playlist-shares/${encodeURIComponent(id)}`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, ...(name ? { name } : {}) }),
        });
        const j = (await r.json().catch(() => ({}))) as { error?: string; copy?: Playlist | null };
        if (!r.ok) return { ok: false, error: j.error ?? "Something went wrong" };
        reload();
        if (j.copy) window.dispatchEvent(new CustomEvent("library-updated")); // the new playlist appears in the library
        return { ok: true, copy: j.copy ?? null };
      } catch {
        return { ok: false, error: "No connection. Try again." };
      }
    },
    [reload],
  );

  return { pending: branchId ? pending : [], accepted: branchId ? accepted : [], loaded, reload, answer };
}

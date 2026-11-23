"use client";

/**
 * The playlist shares of THIS window's branch (owner 2026-11-22, sharing phase C): what waits for an answer and what was accepted (live). Reads /api/playlist-shares for the branch, refreshes when the
 * library says it changed (the share arrives through the same LIBRARY_UPDATED the server sends), when the window gets focus, and once a minute while it is visible. `branchId` null = a branch that cannot
 * receive shares (no real branch) → only the shares sent to ME as a person are read (phase D). A newly arrived request raises the toast once.
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
  /** "BRANCH" = a branch of the sender's own business; "USER" = sent to a PERSON (possibly in another business) */
  kind: "BRANCH" | "USER";
  /** the sender's business — only for a share to a person */
  fromBusiness: string | null;
  /** as the SENDER sees a share to a person: who it went to */
  targetName: string | null;
  targetHandle: string | null;
  playlist: Playlist | null;
};
export type ShareAnswer = "accept" | "decline" | "copy" | "revoke" | "leave";
export type ShareAnswerResult = { ok: true; copy: Playlist | null } | { ok: false; error: string };

export function usePlaylistShares(branchId: string | null, newRequestMessage: (n: number) => string): {
  pending: ShareView[];
  accepted: ShareView[];
  loaded: boolean;
  reload: () => void;
  answer: (id: string, action: ShareAnswer, name?: string, branchId?: string) => Promise<ShareAnswerResult>;
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
    let off = false;
    const read = (url: string): Promise<ShareView[] | null> =>
      fetch(url, { cache: "no-store", credentials: "include" }).then((r) => (r.ok ? (r.json() as Promise<ShareView[]>) : null));
    // the branch's shares (only for a branch that can receive them) + the shares sent to ME as a person, from any business
    Promise.all([branchId ? read(`/api/playlist-shares?status=all&branchId=${encodeURIComponent(branchId)}`) : Promise.resolve([] as ShareView[]), read("/api/playlist-shares/mine?status=all")])
      .then(([forBranch, forMe]) => {
        if (off || !Array.isArray(forBranch) || !Array.isArray(forMe)) return null; // a failed read keeps what is on screen
        const seenIds = new Set<string>();
        return [...forBranch, ...forMe].filter((x) => (seenIds.has(x.id) ? false : (seenIds.add(x.id), true)));
      })
      .then((list) => {
        if (off || !Array.isArray(list)) return;
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
  }, [reload]);

  const answer = useCallback(
    async (id: string, action: ShareAnswer, name?: string, copyBranchId?: string): Promise<ShareAnswerResult> => {
      try {
        const r = await fetch(`/api/playlist-shares/${encodeURIComponent(id)}`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, ...(name ? { name } : {}), ...(copyBranchId ? { branchId: copyBranchId } : {}) }),
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

  return { pending, accepted, loaded, reload, answer };
}

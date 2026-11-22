"use client";

/**
 * "Share inside VONO" (owner 2026-11-22, sharing phase C): send a playlist to chosen branches of the SAME business (or all of them). The receiving branch is ASKED — nothing appears there until
 * someone accepts. Also shows where this playlist is already shared (waiting / accepted) with "take back". Not a link: for a link the share dialog keeps its own buttons.
 * Talks to POST/GET /api/playlists/:id/shares and POST /api/playlist-shares/:id (revoke).
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { GlassModal } from "@/components/glass-modal";
import { useLocale } from "@/lib/locale-context";
import type { Playlist } from "@/lib/playlist-types";
import type { ShareView } from "@/lib/use-playlist-shares";

type Branch = { id: string; name: string };

const HE = {
  title: "שיתוף בתוך VONO",
  intro: "בחרו לאילו סניפים של העסק לשלוח. הסניף יקבל בקשה, ורק אחרי שיאשרו הפלייליסט יופיע שם.",
  all: "כל הסניפים",
  waiting: "ממתין לאישור",
  accepted: "אושר",
  takeBack: "ביטול השיתוף",
  send: "שליחה",
  cancel: "סגירה",
  none: "אין סניפים נוספים בעסק לשיתוף.",
  sent: (n: number) => (n === 1 ? "נשלח לסניף אחד" : `נשלח ל-${n} סניפים`),
  already: "כבר משותף עם הסניפים שנבחרו.",
  failed: "השיתוף נכשל. נסו שוב.",
  loading: "טוען…",
};
const EN = {
  title: "Share inside VONO",
  intro: "Choose which branches of the business to send it to. The branch is asked first — the playlist appears there only after someone accepts.",
  all: "All branches",
  waiting: "Waiting for an answer",
  accepted: "Accepted",
  takeBack: "Take back",
  send: "Send",
  cancel: "Close",
  none: "There are no other branches in this business to share with.",
  sent: (n: number) => (n === 1 ? "Sent to 1 branch" : `Sent to ${n} branches`),
  already: "Already shared with the chosen branches.",
  failed: "Sharing failed. Try again.",
  loading: "Loading…",
};

const toast = (message: string) => window.dispatchEvent(new CustomEvent("syncbiz:toast", { detail: { message } }));

export function PlaylistShareDialog({ playlistId, onClose }: { playlistId: string; onClose: () => void }): ReactElement {
  const { locale } = useLocale();
  const he = locale === "he";
  const t = he ? HE : EN;
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [shares, setShares] = useState<ShareView[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let off = false;
    Promise.all([
      fetch(`/api/playlists/${encodeURIComponent(playlistId)}`, { credentials: "include", cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/branches", { credentials: "include", cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
      fetch(`/api/playlists/${encodeURIComponent(playlistId)}/shares`, { credentials: "include", cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([p, b, s]) => {
        if (off) return;
        setPlaylist(p as Playlist | null);
        setBranches((Array.isArray(b) ? b : []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
        setShares(Array.isArray(s) ? (s as ShareView[]) : []);
      })
      .catch(() => {
        if (!off) setBranches([]);
      });
    return () => {
      off = true;
    };
  }, [playlistId, tick]);

  const own = playlist?.branchId ?? null;
  const candidates = (branches ?? []).filter((b) => b.id !== own);
  const open = new Map<string, ShareView>();
  for (const s of shares) if (s.status === "PENDING" || s.status === "ACCEPTED") open.set(s.targetBranchId, s);
  const free = candidates.filter((b) => !open.has(b.id));
  const allPicked = free.length > 0 && free.every((b) => picked.has(b.id));

  const toggle = (id: string) =>
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(free.map((b) => b.id)));

  const send = useCallback(async () => {
    if (busy || picked.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/shares`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ branchIds: [...picked] }),
      });
      const j = (await r.json().catch(() => ({}))) as { created?: unknown[]; alreadyOpen?: number; error?: string };
      if (!r.ok) {
        setError(j.error ?? t.failed);
        return;
      }
      const n = j.created?.length ?? 0;
      toast(n > 0 ? t.sent(n) : t.already);
      setPicked(new Set());
      setTick((x) => x + 1);
    } catch {
      setError(t.failed);
    } finally {
      setBusy(false);
    }
  }, [busy, picked, playlistId, t]);

  const takeBack = async (shareId: string) => {
    setBusy(true);
    try {
      await fetch(`/api/playlist-shares/${encodeURIComponent(shareId)}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      });
      setTick((x) => x + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassModal
      title={t.title}
      subtitle={playlist?.name ?? null}
      cover={playlist?.cover || playlist?.thumbnail || null}
      showInitial
      width={480}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="sb-wz-btn" onClick={onClose}>
            {t.cancel}
          </button>
          <span className="sb-wz-spacer" />
          <button type="button" className="sb-wz-btn sb-wz-btn--primary" disabled={busy || picked.size === 0} onClick={() => void send()}>
            {t.send}
          </button>
        </>
      }
    >
      <div dir={he ? "rtl" : "ltr"} className="sb-shr-dlg">
        <p className="sb-wz-hint">{t.intro}</p>
        {branches === null ? (
          <p className="sb-wz-hint">{t.loading}</p>
        ) : candidates.length === 0 ? (
          <p className="sb-wz-hint">{t.none}</p>
        ) : (
          <ul className="sb-shr-branches">
            {free.length > 1 ? (
              <li>
                <button type="button" className="sb-shr-brow" data-on={allPicked ? "1" : undefined} onClick={toggleAll}>
                  <span className="sb-shr-check" aria-hidden />
                  <span className="sb-shr-bname">{t.all}</span>
                </button>
              </li>
            ) : null}
            {candidates.map((b) => {
              const s = open.get(b.id);
              return (
                <li key={b.id}>
                  {s ? (
                    <div className="sb-shr-brow sb-shr-brow--done">
                      <span className="sb-shr-check sb-shr-check--done" aria-hidden />
                      <span className="sb-shr-bname">{b.name}</span>
                      <span className="sb-shr-state">{s.status === "ACCEPTED" ? t.accepted : t.waiting}</span>
                      <button type="button" className="sb-shr-undo" disabled={busy} onClick={() => void takeBack(s.id)}>
                        {t.takeBack}
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="sb-shr-brow" data-on={picked.has(b.id) ? "1" : undefined} onClick={() => toggle(b.id)}>
                      <span className="sb-shr-check" aria-hidden />
                      <span className="sb-shr-bname">{b.name}</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {error ? <p className="sb-shr-err" role="alert">{error}</p> : null}
      </div>
    </GlassModal>
  );
}

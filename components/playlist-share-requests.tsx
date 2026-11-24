"use client";

/**
 * A playlist was SHARED with this branch (owner 2026-11-22, sharing phase C): the request card. A square with the playlist's picture, its name under it, who made it and how many songs; "Look inside" glides the
 * picture up into the corner and opens the numbered song list (read-only — nothing plays, nothing changes); then the receiver decides: ACCEPT (live — the playlist updates when its owner changes it),
 * MAKE MY COPY (a playlist of their own, with a name of their own — only songs that play from a web address) or DECLINE. Nothing appears in the library before an answer.
 */
import { useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { GlassModal } from "@/components/glass-modal";
import { PlaylistWorkspacePanel } from "@/components/playlist-workspace-panel";
import { useLocale } from "@/lib/locale-context";
import { sharedPlaylistLeaves } from "@/lib/shared-playlist-source";
import type { ShareAnswer, ShareAnswerResult, ShareView } from "@/lib/use-playlist-shares";

const HE = {
  title: "שותף עם הסניף הזה",
  from: (n: string | null) => (n ? `מאת ${n}` : "שיתוף חדש"),
  by: "נוצר על ידי",
  songs: (n: number) => (n === 1 ? "שיר אחד" : `${n} שירים`),
  look: "הצצה פנימה",
  accept: "לאשר",
  copy: "עותק משלי",
  decline: "לדחות",
  create: "יצירת עותק",
  cancel: "ביטול",
  copyName: "שם העותק שלך",
  copyHint: "העותק הוא פלייליסט שלכם. שינויים של הבעלים לא ישפיעו עליו, ושירים שהם קבצים במחשב אחר לא יועתקו.",
  counter: (i: number, n: number) => `${i} מתוך ${n}`,
  okAccept: "נוסף לסניף — הוא מתעדכן אוטומטית",
  okCopy: "העותק נוצר",
  okDecline: "נדחה",
  noConn: "אין חיבור. נסו שוב.",
};
const EN = {
  title: "Shared with this branch",
  from: (n: string | null) => (n ? `From ${n}` : "A new share"),
  by: "created by",
  songs: (n: number) => (n === 1 ? "1 song" : `${n} songs`),
  look: "Look inside",
  accept: "Accept",
  copy: "Make my copy",
  decline: "Decline",
  create: "Create my copy",
  cancel: "Cancel",
  copyName: "Name of your copy",
  copyHint: "The copy is your own playlist. Changes by the owner will not reach it, and songs that are files on another computer are not copied.",
  counter: (i: number, n: number) => `${i} of ${n}`,
  okAccept: "Added to this branch — it updates by itself",
  okCopy: "Your copy was created",
  okDecline: "Declined",
  noConn: "No connection. Try again.",
};

const toast = (message: string) => window.dispatchEvent(new CustomEvent("syncbiz:toast", { detail: { message } }));

/** the small "N waiting" button the library shows while requests wait */
export function PlaylistSharePill({ count, onClick }: { count: number; onClick: () => void }): ReactElement | null {
  const { locale } = useLocale();
  if (count <= 0) return null;
  const he = locale === "he";
  return (
    <button type="button" className="sb-shr-pill" onClick={onClick} title={he ? "פלייליסטים ששותפו עם הסניף הזה" : "Playlists shared with this branch"}>
      <i aria-hidden />
      {he ? `${count} שיתופים ממתינים` : count === 1 ? "1 share waiting" : `${count} shares waiting`}
    </button>
  );
}

export function PlaylistShareRequests({
  pending,
  onAnswer,
  onClose,
}: {
  pending: ShareView[];
  onAnswer: (id: string, action: ShareAnswer, name?: string) => Promise<ShareAnswerResult>;
  onClose: () => void;
}): ReactElement | null {
  const { locale } = useLocale();
  const he = locale === "he";
  const t = he ? HE : EN;
  const current = pending[0] ?? null;
  const [peek, setPeek] = useState(false);
  const [copying, setCopying] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tileRef = useRef<HTMLSpanElement | null>(null);
  const fromRect = useRef<DOMRect | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // the picture glides from the tile up into the corner of the song list
  useLayoutEffect(() => {
    if (!peek || !fromRect.current) return;
    const to = rootRef.current?.querySelector<HTMLElement>(".sb-alb-cover");
    const a = fromRect.current;
    fromRect.current = null;
    if (!to || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const b = to.getBoundingClientRect();
    if (!b.width || !b.height) return;
    to.animate(
      [{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`, transformOrigin: "top left" }, { transform: "none", transformOrigin: "top left" }],
      { duration: 460, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [peek]);

  if (!current || !current.playlist) return null;
  const pl = current.playlist;
  const leaves = sharedPlaylistLeaves(pl);

  const run = async (action: ShareAnswer, nameIn?: string, okText?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await onAnswer(current.id, action, nameIn);
    setBusy(false);
    if (!r.ok) {
      setError(r.error || t.noConn);
      return;
    }
    toast(okText ?? "");
    setPeek(false);
    setCopying(false);
    setName("");
    if (pending.length <= 1) onClose();
  };

  const openPeek = () => {
    fromRect.current = tileRef.current?.getBoundingClientRect() ?? null;
    setPeek(true);
  };

  return (
    <GlassModal
      title={pending.length > 1 ? `${t.title} · ${t.counter(1, pending.length)}` : t.title}
      subtitle={t.from(current.fromName)}
      width={peek ? 600 : 460}
      onClose={onClose}
      footer={
        copying ? (
          <>
            <button type="button" className="sb-wz-btn" disabled={busy} onClick={() => setCopying(false)}>
              {t.cancel}
            </button>
            <span className="sb-wz-spacer" />
            <button type="button" className="sb-wz-btn sb-wz-btn--primary" disabled={busy || !name.trim()} onClick={() => void run("copy", name.trim(), t.okCopy)}>
              {t.create}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="sb-wz-btn" disabled={busy} onClick={() => void run("decline", undefined, t.okDecline)}>
              {t.decline}
            </button>
            <span className="sb-wz-spacer" />
            <button
              type="button"
              className="sb-wz-btn sb-wz-btn--glass"
              disabled={busy}
              onClick={() => {
                setName(pl.name);
                setCopying(true);
              }}
            >
              {t.copy}
            </button>
            <button type="button" className="sb-wz-btn sb-wz-btn--primary" disabled={busy} onClick={() => void run("accept", undefined, t.okAccept)}>
              {t.accept}
            </button>
          </>
        )
      }
    >
      <div ref={rootRef} dir={he ? "rtl" : "ltr"} className="sb-shr-req">
        {peek ? (
          <div className="sb-shr-peek">
            <PlaylistWorkspacePanel
              mode="preview"
              title={pl.name}
              cover={pl.cover || pl.thumbnail || null}
              createdBy={pl.createdByName ?? null}
              items={leaves}
              activeId={null}
              onBack={() => setPeek(false)}
              onPlayAll={() => {}}
              onPlayItem={() => {}}
              onClassicView={() => {}}
            />
          </div>
        ) : copying ? (
          <div className="sb-shr-copy">
            <label className="sb-wz-label" htmlFor="sb-shr-copyname">
              {t.copyName}
            </label>
            <input id="sb-shr-copyname" className="sb-wz-input" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && void run("copy", name.trim(), t.okCopy)} autoFocus />
            <p className="sb-wz-hint">{t.copyHint}</p>
          </div>
        ) : (
          <div className="sb-shr-card">
            <span ref={tileRef} className="sb-shr-art">
              {pl.cover || pl.thumbnail ? <img src={pl.cover || pl.thumbnail} alt="" draggable={false} /> : <span className="sb-alb-initial">{pl.name.charAt(0)}</span>}
            </span>
            <h3 className="sb-shr-name" title={pl.name}>
              {pl.name}
            </h3>
            <p className="sb-shr-sub">
              {pl.createdByName ? (
                <>
                  {t.by} <b>{pl.createdByName}</b> ·{" "}
                </>
              ) : null}
              {t.songs(leaves.length)}
            </p>
            <button type="button" className="sb-shr-look" onClick={openPeek}>
              {t.look}
            </button>
          </div>
        )}
        {error ? <p className="sb-shr-err" role="alert">{error}</p> : null}
      </div>
    </GlassModal>
  );
}

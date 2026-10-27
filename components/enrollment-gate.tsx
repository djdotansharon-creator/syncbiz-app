"use client";

/**
 * EnrollmentGate — the one calm screen a NOT-yet-approved device sees (docs/DEVICE_ENROLLMENT_DESIGN.md §5.2; owner 2026-10-27): "this computer is not part of the account yet — ask the manager".
 * The device chooses Player or Remote (a phone can only be a Remote) and the branch, sends the request, and waits; the server gives it no connection token until a manager approves, so it can neither
 * play nor control meanwhile. Renders NOTHING when enrollment is off, when the device is approved, in the desktop app, or while the answer is unknown. Styles: components/enrollment-gate.css.
 */

import { useEffect, useState, type ReactElement } from "react";
import "@/components/enrollment-gate.css";
import { useLocale } from "@/lib/locale-context";
import { detectDeviceLabel, detectPlatform, useEnrollmentGate } from "@/lib/use-enrollment-gate";
import { PlayerIcon, RemoteIcon } from "@/components/device-role-badge";

const HE = {
  title: "המחשב הזה עוד לא חלק מהחשבון",
  sub: "בקשו מהמנהל לצרף אותו. זה לוקח רגע.",
  player: "נגן",
  playerHint: "המחשב הזה מנגן את המוזיקה בסניף",
  remote: "שלט רחוק",
  remoteHint: "המחשב הזה רק שולט בנגן",
  branch: "סניף",
  anyBranch: "כל הסניפים שלי",
  note: "הערה למנהל (לא חובה)",
  send: "בקשת אישור",
  sending: "שולח…",
  waiting: "ממתין לאישור המנהל",
  waitingSub: "נעדכן אותך כשיאושר — אפשר להשאיר את המסך הזה פתוח.",
  expires: (d: number) => (d <= 1 ? "הבקשה תפוג היום" : `הבקשה תפוג בעוד ${d} ימים`),
  rejected: "הבקשה נדחתה",
  revoked: "האישור למכשיר הזה בוטל",
  expired: "הבקשה פגה",
  again: "בקשה חדשה",
  errors: { branch_required_for_player: "בחרו סניף לנגן.", too_many_pending_requests: "יש יותר מדי בקשות פתוחות. המתינו שהמנהל יטפל בהן.", enrollment_disabled: "האישור לא פעיל כרגע.", other: "משהו השתבש. נסו שוב." } as Record<string, string>,
};
const EN = {
  title: "This computer is not part of the account yet",
  sub: "Ask the manager to add it. It takes a moment.",
  player: "Player",
  playerHint: "This computer plays the music in the branch",
  remote: "Remote",
  remoteHint: "This computer only controls the player",
  branch: "Branch",
  anyBranch: "All my branches",
  note: "Note for the manager (optional)",
  send: "Request approval",
  sending: "Sending…",
  waiting: "Waiting for the manager's approval",
  waitingSub: "We will let you know when it is approved — you can keep this screen open.",
  expires: (d: number) => (d <= 1 ? "The request expires today" : `The request expires in ${d} days`),
  rejected: "The request was declined",
  revoked: "This device's approval was cancelled",
  expired: "The request expired",
  again: "New request",
  errors: { branch_required_for_player: "Choose a branch for the player.", too_many_pending_requests: "Too many open requests. Wait for the manager to handle them.", enrollment_disabled: "Approval is not active right now.", other: "Something went wrong. Try again." } as Record<string, string>,
};

type Branch = { id: string; name: string };

export function EnrollmentGate(): ReactElement | null {
  const { locale } = useLocale();
  const he = locale === "he";
  const t = he ? HE : EN;
  const { state, request } = useEnrollmentGate();
  const platform = detectPlatform();
  const phone = platform !== "browser";
  const [role, setRole] = useState<"PLAYER" | "REMOTE">("REMOTE");
  const [branchId, setBranchId] = useState<string>("");
  const [note, setNote] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [again, setAgain] = useState(false);

  const needs = !!state && state.enforced && state.status !== "approved";
  useEffect(() => {
    if (!needs) return;
    let off = false;
    void fetch("/api/branches", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ id?: unknown; name?: unknown }>) => {
        if (off || !Array.isArray(rows)) return;
        const list = rows.filter((b) => typeof b.id === "string").map((b) => ({ id: String(b.id), name: typeof b.name === "string" ? b.name : String(b.id) }));
        setBranches(list);
        if (list.length === 1) setBranchId(list[0]!.id);
      })
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [needs]);

  if (!state || !state.enforced || state.status === "approved") return null;
  const showForm = state.status === "unknown" || again;
  const effectiveRole = phone ? "REMOTE" : role;

  const send = async () => {
    setBusy(true);
    setErr(null);
    const r = await request({ role: effectiveRole, branchId: branchId || null, label: detectDeviceLabel(), note, platform });
    setBusy(false);
    if (!r.ok) setErr(t.errors[r.error ?? "other"] ?? t.errors.other!);
    else setAgain(false);
  };

  const daysLeft = state.status === "pending" ? Math.max(0, Math.ceil((new Date(state.expiresAt).getTime() - Date.now()) / 86_400_000)) : 0;

  return (
    <div className="vono-enr" dir={he ? "rtl" : "ltr"} role="dialog" aria-modal="true" aria-label={t.title}>
      <div className="vono-enr-card">
        {showForm ? (
          <>
            <h2>{t.title}</h2>
            <p className="vono-enr-sub">{t.sub}</p>
            {state.status === "rejected" || state.status === "revoked" || state.status === "expired" ? (
              <p className="vono-enr-state">{state.status === "rejected" ? t.rejected : state.status === "revoked" ? t.revoked : t.expired}{state.status === "rejected" && state.decisionNote ? ` — ${state.decisionNote}` : ""}</p>
            ) : null}
            <div className="vono-enr-choice" role="radiogroup">
              <button type="button" role="radio" aria-checked={effectiveRole === "PLAYER"} disabled={phone} data-on={effectiveRole === "PLAYER" ? "1" : undefined} data-kind="player" onClick={() => setRole("PLAYER")}>
                <span className="ic"><PlayerIcon /></span>
                <b>{t.player}</b>
                <small>{t.playerHint}</small>
              </button>
              <button type="button" role="radio" aria-checked={effectiveRole === "REMOTE"} data-on={effectiveRole === "REMOTE" ? "1" : undefined} data-kind="remote" onClick={() => setRole("REMOTE")}>
                <span className="ic"><RemoteIcon /></span>
                <b>{t.remote}</b>
                <small>{t.remoteHint}</small>
              </button>
            </div>
            {branches.length > 1 ? (
              <label className="vono-enr-field">
                <span>{t.branch}</span>
                <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  <option value="">{effectiveRole === "PLAYER" ? "—" : t.anyBranch}</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="vono-enr-field">
              <span>{t.note}</span>
              <input type="text" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            {err ? <p className="vono-enr-err" role="alert">{err}</p> : null}
            <button type="button" className="vono-enr-send" disabled={busy || (effectiveRole === "PLAYER" && !branchId)} onClick={() => void send()}>{busy ? t.sending : t.send}</button>
          </>
        ) : state.status === "pending" ? (
          <>
            <h2>{t.waiting}</h2>
            <p className="vono-enr-dots" aria-hidden><i /><i /><i /></p>
            <p className="vono-enr-sub">{t.waitingSub}</p>
            <p className="vono-enr-sub vono-enr-small">{t.expires(daysLeft)}</p>
          </>
        ) : (
          <>
            <h2>{state.status === "rejected" ? t.rejected : state.status === "revoked" ? t.revoked : t.expired}</h2>
            {state.status === "rejected" && state.decisionNote ? <p className="vono-enr-sub">{state.decisionNote}</p> : null}
            <button type="button" className="vono-enr-send" onClick={() => setAgain(true)}>{t.again}</button>
          </>
        )}
      </div>
    </div>
  );
}

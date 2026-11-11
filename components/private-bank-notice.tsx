"use client";

/**
 * PRIVATE BANK NOTICE (owner 2026-11-11): a calm pill next to the "Update" pill on the station's own window. From the moment
 * a private bank is switched off it says when the bank stops (the next 04:00, branch time); after that, that the station
 * now plays its fallback music. A payment lock says so (future billing). Click to read the full sentence; Esc / outside
 * click closes. Data: the private-bank guard's store (components/private-bank-guard.tsx) — no fetch of its own.
 */

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/locale-context";
import { useBankNotice, type GuardBank } from "@/components/private-bank-guard";
import "@/components/music-bank/private-bank-notice.css";

function whenText(iso: string | null, he: boolean): string {
  if (!iso) return "";
  const d = new Date(iso);
  const locale = he ? "he-IL" : "en-GB";
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (sameDay(d, now)) return he ? `היום ב־${time}` : `today at ${time}`;
  if (sameDay(d, tomorrow)) return he ? `מחר ב־${time}` : `tomorrow at ${time}`;
  const day = d.toLocaleDateString(locale, { day: "numeric", month: "short" });
  return he ? `ב־${day}, ${time}` : `on ${day} at ${time}`;
}

function sentence(b: GuardBank, he: boolean): { short: string; full: string } {
  const when = whenText(b.endsAt, he);
  if (b.state === "closed") {
    return he
      ? { short: `${b.name} הסתיים`, full: `${b.name} כבר לא פעיל. במקומו מתנגנת מוזיקת הגיבוי של העסק.` }
      : { short: `${b.name} ended`, full: `${b.name} is no longer active. Your business's fallback music plays instead.` };
  }
  if (b.reason === "payment") {
    return he
      ? { short: `${b.name} · עד ${when}`, full: `המוזיקה של ${b.name} תפסיק להתנגן ${when}, אלא אם יוסדר התשלום.` }
      : { short: `${b.name} · until ${when}`, full: `From ${when}, ${b.name} will no longer play unless the payment is settled.` };
  }
  return he
    ? { short: `${b.name} · עד ${when}`, full: `${b.name} מתנגן עד ${when}. אחר כך תתנגן מוזיקת הגיבוי של העסק.` }
    : { short: `${b.name} · until ${when}`, full: `${b.name} plays until ${when}. After that your business's fallback music plays.` };
}

export function PrivateBankNotice() {
  const banks = useBankNotice();
  const { locale } = useLocale();
  const he = locale === "he";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (banks.length === 0) return null;
  // the most urgent first: closing (soonest) before already-closed
  const b = [...banks].sort((x, y) => (x.state === y.state ? Date.parse(x.endsAt ?? "") - Date.parse(y.endsAt ?? "") : x.state === "closing" ? -1 : 1))[0];
  const s = sentence(b, he);
  return (
    <span ref={ref} className="sb-bank-notice-wrap">
      <button
        type="button"
        className="sb-bank-notice"
        data-state={b.state}
        aria-expanded={open}
        title={s.full}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sb-bank-notice-dot" aria-hidden />
        <span className="sb-bank-notice-t">{s.short}</span>
      </button>
      {open ? (
        <span className="sb-bank-notice-card" role="status">
          {banks.map((x) => (
            <span key={x.bankId} className="sb-bank-notice-line">{sentence(x, he).full}</span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

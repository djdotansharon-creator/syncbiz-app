"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/locale-context";
import { autoplayNextEnabled, setAutoplayNext } from "@/lib/autoplay-next-pref";

/**
 * "Next song" in the gear menu (owner 2026-11-25), under Graphics: Auto = the player lines up the next song in the first seconds (the queue's next, or the platform's recommendation when nothing is queued) so
 * Next and the end of a song are instant; Off = it does not line up a song nobody chose. Same look as the Graphics row; preference lives in lib/autoplay-next-pref.ts. Display + preference only.
 */
export function AutoplayNextMenuRow() {
  const { locale } = useLocale();
  const he = locale === "he";
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    const read = () => setOn(autoplayNextEnabled());
    read();
    window.addEventListener("syncbiz-autoplay-next-changed", read);
    return () => window.removeEventListener("syncbiz-autoplay-next-changed", read);
  }, []);
  if (on === null) return null;
  const hint = he ? "אוטומטי — השיר הבא מוכן בשניות הראשונות. כבוי — לא מוסיפים שיר שאף אחד לא בחר" : "Auto — the next song is ready in the first seconds. Off — no song nobody chose is added";
  return (
    <div className={`sb-fx-section${he ? " is-he" : ""}`} role="radiogroup" aria-label={he ? "השיר הבא" : "Next song"} title={hint}>
      <span className="sb-fx-title">{he ? "השיר הבא" : "Next song"}</span>
      <div className="sb-fx-row">
        <button type="button" role="radio" aria-checked={on} className="sb-fx-btn" onClick={() => setAutoplayNext(true)}>{he ? "אוטומטי" : "Auto"}</button>
        <button type="button" role="radio" aria-checked={!on} className="sb-fx-btn" onClick={() => setAutoplayNext(false)}>{he ? "כבוי" : "Off"}</button>
      </div>
    </div>
  );
}

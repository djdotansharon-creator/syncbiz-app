"use client";

import { useLocale } from "@/lib/locale-context";
import { useFxMode, writeFxMode, type FxMode } from "@/lib/fx-mode";

const ORDER: FxMode[] = ["full", "lite"];

/**
 * Graphics in the gear menu (owner 2026-10-23), under the Display row: "Full" is the design as it is, "Light" is the same screens with the
 * heavy effects replaced by flat surfaces (simple / older computers). Same store as `?fx=` in the address — lib/fx-mode.ts. Display-only.
 */
export function FxModeMenuRow() {
  const { locale } = useLocale();
  const he = locale === "he";
  const mode = useFxMode();
  const labels: Record<FxMode, string> = { full: he ? "מלאה" : "Full", lite: he ? "קלה" : "Light" };
  const hints: Record<FxMode, string> = {
    full: he ? "העיצוב המלא — זכוכית, טשטוש וצללים" : "The full design — glass, blur and shadows",
    lite: he ? "אותם מסכים, בלי אפקטים כבדים — למחשבים פשוטים" : "The same screens without the heavy effects — for simple computers",
  };
  return (
    <div className={`sb-fx-section${he ? " is-he" : ""}`} role="radiogroup" aria-label={he ? "גרפיקה" : "Graphics"}>
      <span className="sb-fx-title">{he ? "גרפיקה" : "Graphics"}</span>
      <div className="sb-fx-row">
        {ORDER.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} title={hints[m]} className="sb-fx-btn" onClick={() => writeFxMode(m)}>
            {labels[m]}
          </button>
        ))}
      </div>
    </div>
  );
}

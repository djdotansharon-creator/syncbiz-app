"use client";

/**
 * DisplaySettingsConsole — Access Control → Display screen (owner 2026-10-25): the owner chooses the password that opens the controller from the display screen
 * and what staff may do on that screen. A calm column on the management page (no player, black or white by the display mode): a title, three cards.
 * Saved on this device for now (lib/kiosk.ts) — the note on the page says so; sharing it with the store's own screen from the owner's computer needs the
 * server-side setting planned next. Styles: `.sb-kset*` in app/kiosk-display.css.
 */

import { useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { useLocale } from "@/lib/locale-context";
import { DEFAULT_KIOSK_PIN, KIOSK_VOLUME_MIN_CAP, hasCustomKioskPin, lockKiosk, isWithinKioskHours, setKioskHours, setKioskPermissions, setKioskPin, useKioskHours, useKioskOwnerPermissions, type KioskPermissions } from "@/lib/kiosk";

const HE = {
  title: "מסך תצוגה",
  intro: "המסך שהעסק מציג — השיר המתנגן, היום והווידג'טים. מנעול בפינה פותח את הבקר, ורק מי שיודע את הסיסמה נכנס אליו. כאן קובעים את הסיסמה ומה העובדים יכולים לעשות על המסך.",
  pinTitle: "סיסמה",
  pinFirst: "סיסמה ראשונית",
  pinMine: "הסיסמה שלך",
  pinText: (first: string) => `הסיסמה שפותחת את הבקר מהמסך. עד שתבחרו משלכם היא ${first}.`,
  newPin: "סיסמה חדשה",
  again: "הקלידו שוב",
  save: "שמירה",
  reset: (first: string) => `חזרה ל-${first}`,
  tooShort: "לפחות 3 תווים",
  mismatch: "הסיסמאות לא זהות",
  saved: "הסיסמה נשמרה",
  resetDone: (first: string) => `חזרנו ל-${first}`,
  canTitle: "מה העובדים יכולים לעשות",
  canText: "כל מה שתכבו נעלם מהמסך. הבעלים תמיד יכולים הכול אחרי שפתחו את הבקר.",
  skip: ["דילוג על שיר", "הקודם והבא"],
  pause: ["השהיה והפעלה", "עצירת השיר וחידושו"],
  search: ["חיפוש והוספת שירים", "שורת החיפוש שמוסיפה שיר לתור"],
  reorder: ["שינוי סדר ״השירים הבאים״", "הזזת שיר למעלה או למטה בתור"],
  jingles: ["ג'ינגלים", "כפתורי ג'ינגל שמשדרים מיד"],
  volume: ["שליטה בעוצמה", "מחוון עוצמה שנעצר בתקרה שתקבעו"],
  library: ["הוספה לפליילסט ותזמון", "בתפריט ⋯ של תוצאת חיפוש: ״הוסף לפליילסט״ ו״תזמן״ (הם משנים את הספרייה). אם תכבו — נשארים ״נגן עכשיו״ ו״נגן הבא״"],
  createJingles: ["יצירת ג'ינגל חדש", "כפתור + בדף הג'ינגלים: מקלידים משפט, המערכת מקריאה אותו ומוסיפה אותו ככפתור. אם תכבו — העובדים רק משדרים ג'ינגלים שכבר קיימים"],
  playlists: ["הפליילסטים שלי", "עמוד בצד המסך עם הפליילסטים המוכנים של העסק, ולחיצה אחת מעלה פליילסט. אם תכבו — העמוד והאייקון שלו נעלמים"],
  seek: ["הזזת השיר בזמן", "גרירת פס ההתקדמות לדקה אחרת בשיר. אם תכבו — עובדים לא יכולים לקפוץ לדקה מסוימת"],
  volMax: "העוצמה הגבוהה ביותר שעובדים יכולים להגדיר",
  hoursTitle: "שעות פעילות",
  hoursText: "בשעות העבודה חלות ההגבלות שלמעלה. כשהעסק סגור המסך נפתח והעובדים יכולים הכול, כולל לנגן מה שבא להם.",
  hoursSwitch: ["כללים אחרים כשהעסק סגור", "מחוץ לשעות ולימים שתבחרו, כל הכפתורים פתוחים והעוצמה עד הסוף"],
  hoursDays: "ימי עבודה",
  hoursFrom: "פתיחה",
  hoursTo: "סגירה",
  days: ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"],
  hoursNow: (open: boolean) => (open ? "עכשיו: העסק פתוח, ההגבלות חלות" : "עכשיו: העסק סגור, הכול פתוח לעובדים"),
  showTitle: "הצגת המסך",
  showText: "מעלה את מסך התצוגה על המחשב הזה. המוזיקה ממשיכה לנגן ולא נפסקת.",
  show: "פתחו את מסך התצוגה",
  note: "ההגדרות נשמרות במחשב הזה.",
};
const EN = {
  title: "Display screen",
  intro: "The screen the business shows — the song playing, the day and the widgets. A padlock in the corner opens the controller, and only someone who knows the password gets in. Here you set the password and what staff may do on the screen.",
  pinTitle: "Password",
  pinFirst: "First password",
  pinMine: "Your password",
  pinText: (first: string) => `The password that opens the controller from the screen. Until you choose your own it is ${first}.`,
  newPin: "New password",
  again: "Type it again",
  save: "Save",
  reset: (first: string) => `Back to ${first}`,
  tooShort: "At least 3 characters",
  mismatch: "The passwords differ",
  saved: "Password saved",
  resetDone: (first: string) => `Back to ${first}`,
  canTitle: "What staff can do",
  canText: "Anything you switch off disappears from the screen. Owners can always do everything once the controller is open.",
  skip: ["Skip songs", "Previous and next"],
  pause: ["Pause and play", "Stop the song and resume it"],
  search: ["Search and add songs", "The search bar that adds a song to the queue"],
  reorder: ["Reorder “Up next”", "Move a song up or down in the queue"],
  jingles: ["Jingles", "Jingle buttons that go on air at once"],
  volume: ["Volume control", "A volume slider that stops at the limit you set"],
  library: ["Add to playlist and schedule", "In the ⋯ menu of a search result: \"Add to playlist\" and \"Schedule\" (they change the library). Switch it off and only \"Play now\" and \"Play next\" remain"],
  createJingles: ["Make a new jingle", "A + button on the Jingles page: type a sentence, it is spoken and added as a button. Switch it off and staff can only play the jingles that already exist"],
  playlists: ["My playlists", "A page on the side of the screen with the business's ready-made playlists, one press puts one on. Switch it off and the page and its icon disappear"],
  seek: ["Move within the song", "Drag the progress bar to another minute. Switch it off and staff cannot jump to a particular minute"],
  volMax: "The loudest staff can set the volume",
  hoursTitle: "Opening hours",
  hoursText: "While the business is open the limits above apply. When it is closed the screen opens up and staff can do everything, including playing whatever they like.",
  hoursSwitch: ["Different rules when the business is closed", "Outside the days and hours you pick, every button is open and the volume goes all the way up"],
  hoursDays: "Working days",
  hoursFrom: "Opens",
  hoursTo: "Closes",
  days: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  hoursNow: (open: boolean) => (open ? "Right now: open — the limits apply" : "Right now: closed — everything is open to staff"),
  showTitle: "Show the screen",
  showText: "Puts the display screen up on this computer. The music keeps playing — nothing stops.",
  show: "Open the display screen",
  note: "These settings are saved on this computer.",
};

const Ico = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
type SwitchKey = "skip" | "pause" | "search" | "reorder" | "jingles" | "volume" | "seek" | "library" | "playlists" | "createJingles";
const ICONS: Record<SwitchKey, string> = {
  skip: "M5 5v14M19 5v14L8 12z",
  pause: "M8 5v14M16 5v14",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM16.5 16.5 21 21",
  reorder: "M8 4v16M8 4 4.5 7.5M8 4l3.5 3.5M16 20V4M16 20l-3.5-3.5M16 20l3.5-3.5",
  jingles: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  volume: "M4 9v6h4l5 4V5L8 9H4ZM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12",
  seek: "M4 12h16M9 7l-5 5 5 5M15 7l5 5-5 5",
  library: "M4 7h11M4 12h8M4 17h5M18 13v6M15 16h6",
  playlists: "M12 4 3 8.5 12 13l9-4.5L12 4ZM3 12.5l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5",
  createJingles: "M12 5v14M5 12h14",
};
const ORDER: SwitchKey[] = ["skip", "pause", "volume", "seek", "search", "playlists", "library", "reorder", "jingles", "createJingles"];

function Card({ title, badge, children, text }: { title: string; badge?: ReactNode; text?: string; children: ReactNode }): ReactElement {
  return (
    <section className="sb-kset-card">
      <h2>
        {title}
        {badge}
      </h2>
      {text ? <p>{text}</p> : null}
      {children}
    </section>
  );
}

export function DisplaySettingsConsole(): ReactElement {
  const { locale } = useLocale();
  const t = locale === "he" ? HE : EN;
  const perms = useKioskOwnerPermissions();
  const hours = useKioskHours();
  const [custom, setCustom] = useState(() => hasCustomKioskPin());
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (a.trim().length < 3) return setMsg({ kind: "bad", text: t.tooShort });
    if (a !== b) return setMsg({ kind: "bad", text: t.mismatch });
    await setKioskPin(a);
    setCustom(true);
    setA("");
    setB("");
    setMsg({ kind: "ok", text: t.saved });
  };
  const reset = async () => {
    await setKioskPin("");
    setCustom(false);
    setMsg({ kind: "ok", text: t.resetDone(DEFAULT_KIOSK_PIN) });
  };

  return (
    <div className="sb-kset">
      <header className="sb-kset-head">
        <h1>{t.title}</h1>
        <p>{t.intro}</p>
      </header>

      <Card title={t.pinTitle} text={t.pinText(DEFAULT_KIOSK_PIN)} badge={<span className="sb-kset-badge" data-on={custom ? "1" : undefined}>{custom ? t.pinMine : t.pinFirst}</span>}>
        <form onSubmit={(e) => void submit(e)}>
          <div className="sb-kset-fields">
            <label className="sb-kset-field">
              <span>{t.newPin}</span>
              <input type="password" autoComplete="new-password" value={a} onChange={(e) => (setA(e.target.value), setMsg(null))} />
            </label>
            <label className="sb-kset-field">
              <span>{t.again}</span>
              <input type="password" autoComplete="new-password" value={b} onChange={(e) => (setB(e.target.value), setMsg(null))} />
            </label>
          </div>
          <div className="sb-kset-actions">
            <button type="submit" className="sb-kset-btn" disabled={!a || !b}>{t.save}</button>
            {custom ? <button type="button" className="sb-kset-btn is-quiet" onClick={() => void reset()}>{t.reset(DEFAULT_KIOSK_PIN)}</button> : null}
            {msg ? <span className="sb-kset-msg" data-kind={msg.kind} role="status">{msg.text}</span> : null}
          </div>
        </form>
      </Card>

      <Card title={t.canTitle} text={t.canText}>
        <div className="sb-kset-rows">
          {ORDER.map((k) => {
            const [name, hint] = t[k];
            return (
              <div key={k} className="sb-kset-row">
                <span className="sb-kset-ico"><Ico d={ICONS[k]} /></span>
                <span>
                  <b>{name}</b>
                  <small>{hint}</small>
                </span>
                <button type="button" role="switch" aria-checked={perms[k]} aria-label={name} className="sb-kset-switch" onClick={() => setKioskPermissions({ [k]: !perms[k] })}>
                  <i aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
        {perms.volume ? (
          <div className="sb-kset-cap">
            <span>{t.volMax}</span>
            <input type="range" min={KIOSK_VOLUME_MIN_CAP} max={100} step={5} value={perms.volumeMax} onChange={(e) => setKioskPermissions({ volumeMax: Number(e.target.value) })} aria-label={t.volMax} style={{ ["--v" as string]: `${((perms.volumeMax - KIOSK_VOLUME_MIN_CAP) / (100 - KIOSK_VOLUME_MIN_CAP)) * 100}%` } as React.CSSProperties} />
            <b>{perms.volumeMax}%</b>
          </div>
        ) : null}
      </Card>

      <Card title={t.hoursTitle} text={t.hoursText}>
        <div className="sb-kset-rows">
          <div className="sb-kset-row sb-kset-row--plain">
            <span>
              <b>{t.hoursSwitch[0]}</b>
              <small>{t.hoursSwitch[1]}</small>
            </span>
            <button type="button" role="switch" aria-checked={hours.enabled} aria-label={t.hoursSwitch[0]} className="sb-kset-switch" onClick={() => setKioskHours({ enabled: !hours.enabled })}>
              <i aria-hidden />
            </button>
          </div>
        </div>
        {hours.enabled ? (
          <div className="sb-kset-hours">
            <div className="sb-kset-days" role="group" aria-label={t.hoursDays}>
              {t.days.map((label, d) => (
                <button key={d} type="button" data-on={hours.days.includes(d) ? "1" : undefined} aria-pressed={hours.days.includes(d)} onClick={() => setKioskHours({ days: hours.days.includes(d) ? hours.days.filter((x) => x !== d) : [...hours.days, d] })}>
                  {label}
                </button>
              ))}
            </div>
            <div className="sb-kset-times">
              <label className="sb-kset-field">
                <span>{t.hoursFrom}</span>
                <input type="time" value={hours.from} onChange={(e) => e.target.value && setKioskHours({ from: e.target.value })} />
              </label>
              <label className="sb-kset-field">
                <span>{t.hoursTo}</span>
                <input type="time" value={hours.to} onChange={(e) => e.target.value && setKioskHours({ to: e.target.value })} />
              </label>
            </div>
            <p className="sb-kset-now">{t.hoursNow(isWithinKioskHours(hours, new Date()))}</p>
          </div>
        ) : null}
      </Card>

      <Card title={t.showTitle} text={t.showText}>
        <div className="sb-kset-actions" style={{ marginTop: 0 }}>
          <button type="button" className="sb-kset-btn" onClick={() => lockKiosk()}>{t.show}</button>
        </div>
      </Card>
      <p className="sb-kset-note">{t.note}</p>
    </div>
  );
}

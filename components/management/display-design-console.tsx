"use client";

/**
 * DisplayDesignConsole — the "Lock screen design" tab of the top bar (owner 2026-10-26): the owner arranges what the business's display screen SHOWS. One screen, no scrolling: on one side
 * the preview (the real screen in miniature, mirrored for Hebrew) with three ready-made looks under it and the "Show on the screen" button; on the other side a short list of settings, each a
 * single line with one control — how the song is shown (full player / small square), the song's name beside the square, which icons are on the edge, the clock, the next-song notice.
 * Everything is saved at once and the screen follows immediately (lib/kiosk-design.ts). What staff may DO on the screen (password, buttons) is the other page: Access Control → Display screen.
 * Styles: `.sb-kdes*` (+ the shared `.sb-kset*`) in app/kiosk-display.css.
 */

import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/locale-context";
import { lockKiosk } from "@/lib/kiosk";
import { DESIGN_ICONS, KIOSK_PRESETS, applyKioskPreset, matchingPreset, setKioskDesign, useKioskDesign, type DesignIcon, type KioskDesign } from "@/lib/kiosk-design";
import { KioskTabIcon } from "@/components/kiosk-tab-icons";

const HE = {
  title: "עיצוב מסך נעילה",
  intro: "בוחרים, והמסך משתנה מיד.",
  cafe: "בית קפה",
  supermarket: "סופרמרקט",
  song: "רק השיר",
  custom: "מותאם אישית",
  layoutT: "איך מוצג השיר",
  full: "נגן מלא",
  mini: "ריבוע קטן",
  miniH: "עומדים על הריבוע ורואים שם ושני פסים. מתחתיו פס התקדמות תמיד",
  iconsT: "אייקונים בצד",
  iconsH: "כל אייקון פותח דף",
  icon: { next: "בתור הבא", search: "חיפוש", lists: "פליילסטים", jingles: "ג'ינגלים", day: "היום" } as Record<DesignIcon, string>,
  clockT: "שעון ותאריך",
  noticeT: "השיר הבא בפינה",
  show: "הצגה על המסך",
  perms: "סיסמה והרשאות לעובדים",
  previewLabel: "תצוגה מקדימה",
  note: "נשמר אוטומטית במחשב הזה.",
};
const EN = {
  title: "Lock screen design",
  intro: "Pick, and the screen changes at once.",
  cafe: "Café",
  supermarket: "Supermarket",
  song: "Just the song",
  custom: "Custom",
  layoutT: "How the song is shown",
  full: "Full player",
  mini: "Small square",
  miniH: "Rest on the square to see the name and two bars. A progress bar under it is always there",
  iconsT: "Icons on the side",
  iconsH: "Each icon opens a page",
  icon: { next: "Up next", search: "Search", lists: "Playlists", jingles: "Jingles", day: "Today" } as Record<DesignIcon, string>,
  clockT: "Clock and date",
  noticeT: "Next song in the corner",
  show: "Show on the screen",
  perms: "Password and staff permissions",
  previewLabel: "Preview",
  note: "Saved automatically on this computer.",
};

/** the preview: the real screen in miniature (same proportions: 1 em = 1 % of the screen's width), mirrored for Hebrew — the song on the left, the icons on the right */
function Preview({ design, he }: { design: KioskDesign; he: boolean }): ReactElement {
  return (
    <div className="sb-kdes-preview" data-he={he ? "1" : undefined} data-layout={design.layout} aria-hidden>
      <div className="sb-kdes-screen">
        <i className="sb-kdes-glow a" />
        <i className="sb-kdes-glow b" />
        {design.clock ? (
          <div className="sb-kdes-clock">
            <b>12:30</b>
            <span />
          </div>
        ) : null}
        {design.layout === "mini" ? (
          <>
            <div className="sb-kdes-minibar">
              <div className="sb-kdes-miniwrap">
                <div className="sb-kdes-mini">
                  <svg viewBox="0 0 24 24" fill="currentColor"><rect x="5.2" y="4" width="4.9" height="16" rx="1.9" /><rect x="13.9" y="4" width="4.9" height="16" rx="1.9" /></svg>
                </div>
                <span className="sb-kdes-prog" />
              </div>
            </div>
            {design.icons.length > 0 ? (
              <div className="sb-kdes-page">
                <span />
                <span />
                <span />
              </div>
            ) : null}
          </>
        ) : (
          <div className="sb-kdes-song">
            <div className="sb-kdes-cover">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
            </div>
            <span className="sb-kdes-title" />
            <span className="sb-kdes-artist" />
            <span className="sb-kdes-seek" />
            <div className="sb-kdes-ctl">
              <svg viewBox="0 0 24 24" fill="currentColor"><rect x="4.4" y="4.6" width="2.8" height="14.8" rx="1.4" /><path d="M20 5.7c0-.8-.9-1.3-1.6-.8l-9 6.3c-.6.4-.6 1.3 0 1.7l9 6.3c.7.5 1.6 0 1.6-.8V5.7Z" /></svg>
              <svg className="big" viewBox="0 0 24 24" fill="currentColor"><rect x="5.2" y="4" width="4.9" height="16" rx="1.9" /><rect x="13.9" y="4" width="4.9" height="16" rx="1.9" /></svg>
              <svg viewBox="0 0 24 24" fill="currentColor"><rect x="16.8" y="4.6" width="2.8" height="14.8" rx="1.4" /><path d="M4 5.7c0-.8.9-1.3 1.6-.8l9 6.3c.6.4.6 1.3 0 1.7l-9 6.3c-.7.5-1.6 0-1.6-.8V5.7Z" /></svg>
            </div>
            <span className="sb-kdes-vol" />
          </div>
        )}
        {design.icons.length > 0 ? (
          <div className="sb-kdes-rail">
            {design.icons.map((id) => (
              <span key={id}>
                <KioskTabIcon id={id} />
              </span>
            ))}
          </div>
        ) : null}
        {design.notice ? (
          <div className="sb-kdes-notice">
            <span className="art" />
            <span className="txt">
              <i />
              <i />
            </span>
          </div>
        ) : null}
        <span className="sb-kdes-lock" />
        <span className="sb-kdes-lock theme" />
      </div>
    </div>
  );
}

/** a row of choices where exactly one is on (like the segmented controls of a phone's settings) */
function Seg<T extends string>({ label, value, options, onPick }: { label: string; value: T | null; options: ReadonlyArray<{ id: T; label: string }>; onPick: (id: T) => void }): ReactElement {
  return (
    <div className="sb-kdes-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" data-on={value === o.id ? "1" : undefined} aria-pressed={value === o.id} onClick={() => onPick(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** one line of the settings: what it is on one side, how to change it on the other */
function Row({ title, hint, stack, children }: { title: string; hint?: string; stack?: boolean; children: ReactNode }): ReactElement {
  return (
    <div className="sb-kdes-row" data-stack={stack ? "1" : undefined}>
      <div className="sb-kdes-row-t">
        <b>{title}</b>
        {hint ? <small>{hint}</small> : null}
      </div>
      <div className="sb-kdes-row-c">{children}</div>
    </div>
  );
}

function Switch({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }): ReactElement {
  return (
    <button type="button" className="sb-kset-switch" role="switch" aria-checked={on} aria-label={label} onClick={onToggle}>
      <i />
    </button>
  );
}

export function DisplayDesignConsole(): ReactElement {
  const { locale } = useLocale();
  const he = locale === "he";
  const t = he ? HE : EN;
  const design = useKioskDesign();
  const preset = matchingPreset(design);
  const toggleIcon = (id: DesignIcon) => setKioskDesign({ icons: design.icons.includes(id) ? design.icons.filter((x) => x !== id) : [...design.icons, id] });
  const presets = KIOSK_PRESETS.map((p) => ({ id: p.id, label: t[p.id] }));

  return (
    <div className="sb-kset sb-kdes">
      <header className="sb-kdes-head">
        <h1>{t.title}</h1>
        <p>{t.intro}</p>
      </header>

      <div className="sb-kdes-grid">
        <section className="sb-kdes-left" aria-label={t.previewLabel}>
          <Preview design={design} he={he} />
          <div className="sb-kdes-presets">
            <Seg label={t.title} value={preset} options={presets} onPick={applyKioskPreset} />
            {preset === null ? <span className="sb-kset-badge">{t.custom}</span> : null}
          </div>
          <div className="sb-kdes-actions">
            <button type="button" className="sb-kset-btn" onClick={() => lockKiosk()}>
              {t.show}
            </button>
            <Link className="sb-kdes-link" href="/access-control/display">
              {t.perms}
            </Link>
          </div>
        </section>

        <section className="sb-kset-card sb-kdes-controls">
          <Row title={t.layoutT} hint={design.layout === "mini" ? t.miniH : undefined}>
            <Seg
              label={t.layoutT}
              value={design.layout}
              options={[
                { id: "full", label: t.full },
                { id: "mini", label: t.mini },
              ]}
              onPick={(id) => setKioskDesign({ layout: id })}
            />
          </Row>
          <Row title={t.iconsT} hint={t.iconsH} stack>
            <div className="sb-kdes-icons">
              {DESIGN_ICONS.map((id) => (
                <button key={id} type="button" className="sb-kdes-ib" data-on={design.icons.includes(id) ? "1" : undefined} aria-pressed={design.icons.includes(id)} aria-label={t.icon[id]} onClick={() => toggleIcon(id)}>
                  <KioskTabIcon id={id} />
                  <span>{t.icon[id]}</span>
                </button>
              ))}
            </div>
          </Row>
          <Row title={t.clockT}>
            <Switch label={t.clockT} on={design.clock} onToggle={() => setKioskDesign({ clock: !design.clock })} />
          </Row>
          <Row title={t.noticeT}>
            <Switch label={t.noticeT} on={design.notice} onToggle={() => setKioskDesign({ notice: !design.notice })} />
          </Row>
          <p className="sb-kset-note">{t.note}</p>
        </section>
      </div>
    </div>
  );
}

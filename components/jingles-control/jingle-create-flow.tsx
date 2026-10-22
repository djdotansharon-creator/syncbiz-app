"use client";

/**
 * JingleCreateFlow — making a jingle in the simplest way (owner 2026-10-18: "the settings are not understandable — simplify,
 * minimalist, like the DJ AI"). Three calm steps instead of a form of nine fields:
 *   1 · what should it say?   (one big field; Hebrew/English is detected from the words themselves)
 *   2 · how should it sound?   Voice · Language · Speed · Bell (Off / Ding / Chime / Soft — tap to hear it)  → Create
 *       (round 10d, owner: "not enough control over the voice" — the language / speed / bell-style controls of the old form are
 *       back, as calm segmented rows; the language is still DETECTED first, and can be switched)
 *   3 · the result: hear it, then Save · Add to a pad · Schedule · New.
 * Type and title are not asked — they are derived (announcement, first words). Language starts detected, speed starts Normal.
 * A bar along the bottom fills with the steps. Styles: `.sb-dj-*` (shared with the DJ Creator) + `.sb-jf-*`.
 */

import { useState } from "react";
import { RiseText } from "@/components/rise-text";
import { VOICE_PRESETS_BY_LANG, voiceMenuLabel } from "./voice-presets";
import type { AnnouncementDraft, JingleAsset, JingleBellStyle, JingleLanguage, JingleSpeed } from "./types";
import { useTr } from "@/lib/i18n/use-tr";

const IDEAS = [
  "Attention shoppers: fresh bakery items are available at the front of the store. Thank you for shopping with us today.",
  "Friendly reminder: our weekend promotion ends Sunday night. Ask a team member for details.",
  "We will be closing in approximately fifteen minutes. Please bring your final purchases to the registers.",
];

const SPEEDS: readonly { value: JingleSpeed; label: string }[] = [
  { value: "slow", label: "Slow" },
  { value: "normal", label: "Normal" },
  { value: "fast", label: "Fast" },
];
const BELLS: readonly { value: JingleBellStyle; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "ding", label: "Ding" },
  { value: "chime", label: "Chime" },
  { value: "soft", label: "Soft" },
];
const LANGS: readonly { value: JingleLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "he", label: "עברית" },
];

/** a short local preview of a bell (the same synthesized chimes the jingle is announced with) */
function previewBell(style: JingleBellStyle) {
  if (style === "off") return;
  try {
    const a = new Audio(`/api/jingles/bell/${style}`);
    a.volume = 0.7;
    void a.play().catch(() => {});
  } catch {
    /* no preview */
  }
}

function Seg<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: readonly { value: T; label: string }[]; onPick: (v: T) => void }) {
  const tr = useTr();
  return (
    <div className="sb-jf-opt">
      <span>{tr(label)}</span>
      <div className="sb-jf-seg" role="radiogroup" aria-label={tr(label)}>
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? "is-on" : ""} onClick={() => onPick(o.value)}>
            {tr(o.label)}
          </button>
        ))}
      </div>
    </div>
  );
}

function detectLanguage(text: string): JingleLanguage {
  return /[֐-׿]/.test(text) ? "he" : "en";
}

export function JingleCreateFlow({
  draft,
  setDraft,
  generating,
  error,
  onGenerate,
  result,
  isDesktop,
  previewing,
  onPlay,
  onSave,
  onAddToPad,
  onSchedule,
  onNew,
}: {
  draft: AnnouncementDraft;
  setDraft: (u: (d: AnnouncementDraft) => AnnouncementDraft) => void;
  generating: boolean;
  error: string | null;
  onGenerate: () => void;
  result: JingleAsset | null;
  isDesktop: boolean;
  previewing: boolean;
  onPlay: () => void;
  onSave: () => void;
  onAddToPad: () => void;
  onSchedule: (from: HTMLElement) => void;
  onNew: () => void;
}) {
  const tr = useTr();
  const [step, setStep] = useState<0 | 1>(0);
  const [ideas, setIdeas] = useState(false);
  const [saved, setSaved] = useState(false);
  const words = draft.body.trim();
  const voices = VOICE_PRESETS_BY_LANG[draft.language];
  const phase = generating ? "wait" : result ? "done" : step === 0 ? "words" : "voice";
  const pct = phase === "words" ? 24 : phase === "voice" ? 62 : phase === "wait" ? 86 : 100;

  const setBody = (text: string) =>
    setDraft((d) => {
      const lang = text.trim() ? detectLanguage(text) : d.language;
      const voice = lang !== d.language ? VOICE_PRESETS_BY_LANG[lang][0]!.voiceId : d.voice;
      return { ...d, body: text, language: lang, voice };
    });

  return (
    <div className="jcx-flow">
      {phase === "words" ? (
        <div className="sb-dj-stage" key="words">
          <h3 className="sb-dj-q"><RiseText text={tr("What should it say?")} /></h3>
          <textarea
            className="sb-jf-text"
            value={draft.body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={tr("e.g. We close in fifteen minutes. Thank you for shopping with us.")}
            dir="auto"
            autoFocus
          />
          {ideas ? (
            <div className="sb-jf-ideas">
              {IDEAS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setBody(tr(t));
                    setIdeas(false);
                  }}
                >
                  {tr(t)}
                </button>
              ))}
            </div>
          ) : null}
          <div className="sb-jf-row">
            <button type="button" className="sb-dj-pill" onClick={() => setIdeas((v) => !v)}>
              ✦ {ideas ? tr("Hide ideas") : tr("Need an idea?")}
            </button>
            <button type="button" className="sb-dj-go" disabled={!words} onClick={() => setStep(1)}>
              {tr("Next")}
            </button>
          </div>
        </div>
      ) : null}

      {phase === "voice" ? (
        <div className="sb-dj-stage" key="voice">
          <p className="sb-dj-trail">“{words.length > 70 ? `${words.slice(0, 70)}…` : words}”</p>
          <h3 className="sb-dj-q"><RiseText text={tr("How should it sound?")} /></h3>
          <div className="sb-dj-chips">
            {voices.map((v, i) => (
              <button
                key={v.voiceId}
                type="button"
                className={`sb-dj-chip${draft.voice === v.voiceId ? " is-on" : ""}`}
                style={{ ["--d" as string]: `${i * 40}ms` } as React.CSSProperties}
                onClick={() => setDraft((d) => ({ ...d, voice: v.voiceId }))}
              >
                {voiceMenuLabel(v, draft.language)}
              </button>
            ))}
          </div>
          <div className="sb-jf-opts">
            <Seg
              label="Language"
              value={draft.language}
              options={LANGS}
              onPick={(lang) => setDraft((d) => (lang === d.language ? d : { ...d, language: lang, voice: VOICE_PRESETS_BY_LANG[lang][0]!.voiceId }))}
            />
            {draft.language !== "he" ? (
              <Seg label="Speed" value={draft.speed} options={SPEEDS} onPick={(speed) => setDraft((d) => ({ ...d, speed }))} />
            ) : null}
            <Seg
              label="Bell"
              value={draft.preRoll ? draft.bellStyle : "off"}
              options={BELLS}
              onPick={(b) => {
                previewBell(b);
                setDraft((d) => (b === "off" ? { ...d, preRoll: false } : { ...d, preRoll: true, bellStyle: b }));
              }}
            />
          </div>
          {error ? <p className="sb-dj-error">{error}</p> : null}
          <div className="sb-jf-row">
            <button type="button" className="sb-dj-back" onClick={() => setStep(0)}>
              {tr("Back")}
            </button>
            <button type="button" className="sb-dj-go" onClick={onGenerate}>
              {tr("Create")}
            </button>
          </div>
        </div>
      ) : null}

      {phase === "wait" ? (
        <div className="sb-dj-wait" role="status" aria-live="polite" key="wait">
          <span className="sb-dj-wave" aria-hidden><i /><i /><i /><i /><i /></span>
          <p>{tr("Creating your announcement…")}</p>
        </div>
      ) : null}

      {phase === "done" && result ? (
        <div className="sb-dj-stage" key="done">
          <h3 className="sb-dj-q"><RiseText text={result.title || tr("Your jingle")} /></h3>
          <p className="sb-dj-sub">{result.durationLabel && result.durationLabel !== "—" ? `${result.durationLabel} · ` : ""}{draft.language === "he" ? "עברית" : "English"}</p>
          <button type="button" className="sb-jf-play" onClick={onPlay} aria-label={isDesktop ? tr("Play on air") : previewing ? tr("Stop preview") : tr("Preview")}>
            {!isDesktop && previewing ? (
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" aria-hidden><rect x="7" y="7" width="10" height="10" rx="2.2" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" aria-hidden><path d="M8.5 5.5v13l10.5-6.5L8.5 5.5z" /></svg>
            )}
          </button>
          <div className="sb-jf-row">
            <button
              type="button"
              className="sb-dj-pill"
              onClick={() => {
                onSave();
                setSaved(true);
              }}
            >
              {saved ? `${tr("Saved")} ✓` : tr("Save")}
            </button>
            <button type="button" className="sb-dj-pill" onClick={onAddToPad}>{tr("Add to a pad")}</button>
            <button type="button" className="sb-dj-pill" onClick={(e) => onSchedule(e.currentTarget)}>{tr("Schedule")}</button>
          </div>
          <button
            type="button"
            className="sb-dj-back"
            onClick={() => {
              setSaved(false);
              setStep(0);
              onNew();
            }}
          >
            {tr("Make another")}
          </button>
        </div>
      ) : null}

      <div className="sb-dj-bar" data-done={phase === "done" ? "1" : "0"} aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

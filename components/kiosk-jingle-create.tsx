"use client";

/**
 * JingleCreate — making a new jingle ON the display screen (owner 2026-10-26: "in Jingles put the whole creating-a-jingle thing — as simple and easy as possible"). Four calm steps:
 * write one sentence → it is spoken (a few seconds) → hear it → "Add as a button". Nothing else is asked: the language is detected from the words, the voice is the first of that
 * language, the speed is normal, the bell is a "ding" (lib/kiosk-jingle.ts). The finished jingle becomes a button on the Jingles page — on the first free one of the eight, and when
 * all eight are taken the owner picks which to replace. It is also saved in the shared jingles library (the same list the Jingles console shows). Styles: `.sb-kiosk-jmake*`.
 */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { fetchCloudPads, padsFromCloud, savePadToCloud } from "@/components/jingles-control/cloud-pads";
import { VOICE_PRESETS_BY_LANG } from "@/components/jingles-control/voice-presets";
import type { SamplerPadItem } from "@/components/jingles-control/types";
import { detectJingleLanguage, durationLabelToSec, firstFreePad, generateJingle, jingleButtonLabel, type GeneratedJingle } from "@/lib/kiosk-jingle";

const HE = {
  prompt: "מה הג'ינגל צריך להגיד?",
  example: "למשל: מבצע סוף שבוע על לחם טרי, בקרוב נסגרים…",
  create: "יצירה",
  back: "חזרה",
  working: "יוצר את הג'ינגל…",
  ready: "הג'ינגל מוכן",
  hear: "השמעה",
  stop: "עצירה",
  add: "הוספה ככפתור",
  again: "חדש",
  full: "כל הכפתורים תפוסים — איזה להחליף?",
  added: "נוסף ✓",
  failed: (m: string) => `לא הצלחנו ליצור: ${m}`,
  saveFailed: "לא הצלחנו לשמור — בדקו את החיבור ונסו שוב",
};
const EN = {
  prompt: "What should the jingle say?",
  example: "For example: weekend sale on fresh bread, we close soon…",
  create: "Create",
  back: "Back",
  working: "Making the jingle…",
  ready: "The jingle is ready",
  hear: "Listen",
  stop: "Stop",
  add: "Add as a button",
  again: "New",
  full: "All the buttons are taken — which one to replace?",
  added: "Added ✓",
  failed: (m: string) => `Could not create it: ${m}`,
  saveFailed: "Could not save — check the connection and try again",
};

type Made = GeneratedJingle & { label: string; script: string; voiceId: string };

export function JingleCreate({ he, onClose, onAdded }: { he: boolean; onClose: () => void; onAdded: () => void }): ReactElement {
  const w = he ? HE : EN;
  const [step, setStep] = useState<"write" | "working" | "ready" | "pick" | "done">("write");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  const [pads, setPads] = useState<SamplerPadItem[]>([]);
  const [hearing, setHearing] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const holder = audio;
    return () => holder.current?.pause();
  }, []);

  const create = async () => {
    const script = text.trim();
    if (!script) return;
    setError(null);
    setStep("working");
    const language = detectJingleLanguage(script);
    const voiceId = VOICE_PRESETS_BY_LANG[language][0]!.voiceId;
    try {
      const g = await generateJingle(script, language, voiceId);
      setMade({ ...g, label: jingleButtonLabel(script), script, voiceId });
      setStep("ready");
    } catch (e) {
      setError(w.failed(e instanceof Error ? e.message : String(e)));
      setStep("write");
    }
  };

  const hear = () => {
    if (!made) return;
    if (hearing) {
      audio.current?.pause();
      setHearing(false);
      return;
    }
    audio.current?.pause();
    const a = new Audio(made.url);
    a.onended = () => setHearing(false);
    audio.current = a;
    setHearing(true);
    void a.play().catch(() => setHearing(false));
  };

  const assign = async (pad: SamplerPadItem) => {
    if (!made) return;
    try {
      await savePadToCloud({ ...pad, label: made.label, url: made.url, bellStyle: "ding", preRoll: true });
      // the shared list as well (best effort — the same call the Jingles console's Save makes)
      void fetch("/api/jingles/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: made.label, url: made.url, voiceId: made.voiceId, script: made.script, durationSec: durationLabelToSec(made.durationLabel) }),
      }).catch(() => undefined);
      audio.current?.pause();
      setHearing(false);
      setStep("done");
      onAdded();
      window.setTimeout(onClose, 1300);
    } catch {
      setError(w.saveFailed);
    }
  };

  const add = async () => {
    setError(null);
    try {
      const current = padsFromCloud(await fetchCloudPads());
      const free = firstFreePad(current);
      if (free) await assign(free);
      else {
        setPads(current);
        setStep("pick");
      }
    } catch {
      setError(w.saveFailed);
    }
  };

  return (
    <section className="sb-kiosk-jmake" dir={he ? "rtl" : "ltr"} data-step={step}>
      {step === "write" ? (
        <>
          <p className="sb-kiosk-jmake-q">{w.prompt}</p>
          <textarea className="sb-kiosk-jtext" value={text} onChange={(e) => setText(e.target.value)} rows={4} dir="auto" placeholder={w.example} aria-label={w.prompt} />
          {error ? <p className="sb-kiosk-jmake-err" role="alert">{error}</p> : null}
          <div className="sb-kiosk-jbtns">
            <button type="button" className="sb-kiosk-jbtn" disabled={!text.trim()} onClick={() => void create()}>{w.create}</button>
            <button type="button" className="sb-kiosk-jbtn is-quiet" onClick={onClose}>{w.back}</button>
          </div>
        </>
      ) : null}
      {step === "working" ? (
        <div className="sb-kiosk-jmake-wait" role="status">
          <i className="sb-kiosk-jspin" aria-hidden />
          <p>{w.working}</p>
        </div>
      ) : null}
      {step === "ready" && made ? (
        <>
          <p className="sb-kiosk-jmake-q">{w.ready}</p>
          <p className="sb-kiosk-jmake-quote" dir="auto">“{made.script}”</p>
          {error ? <p className="sb-kiosk-jmake-err" role="alert">{error}</p> : null}
          <div className="sb-kiosk-jbtns">
            <button type="button" className="sb-kiosk-jbtn is-quiet" onClick={hear}>{hearing ? w.stop : w.hear}</button>
            <button type="button" className="sb-kiosk-jbtn" onClick={() => void add()}>{w.add}</button>
            <button type="button" className="sb-kiosk-jbtn is-quiet" onClick={() => { audio.current?.pause(); setHearing(false); setMade(null); setStep("write"); }}>{w.again}</button>
          </div>
        </>
      ) : null}
      {step === "pick" ? (
        <>
          <p className="sb-kiosk-jmake-q">{w.full}</p>
          {error ? <p className="sb-kiosk-jmake-err" role="alert">{error}</p> : null}
          <div className="sb-kiosk-chips">
            {pads.map((p) => (
              <button key={p.id} type="button" className="sb-kiosk-chip is-btn" onClick={() => void assign(p)}>
                <span dir="auto">{p.label}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      {step === "done" ? (
        <div className="sb-kiosk-jmake-wait" role="status">
          <p className="sb-kiosk-jmake-ok">{w.added}</p>
        </div>
      ) : null}
    </section>
  );
}

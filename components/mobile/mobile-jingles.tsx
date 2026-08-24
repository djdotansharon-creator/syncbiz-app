"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MobilePageHeader } from "@/components/mobile/mobile-page-header";
import { VOICE_PRESETS_BY_LANG } from "@/components/jingles-control/voice-presets";
import { fetchCloudPads, padsFromCloud, savePadToCloud } from "@/components/jingles-control/cloud-pads";
import type { SamplerPadItem, JingleBellStyle } from "@/components/jingles-control/types";
import { useVoiceRecorder } from "@/components/mobile/use-voice-recorder";
import { useDevicePlayer } from "@/lib/device-player-context";

/**
 * Mobile Jingles — one area for BOTH ways to make an announcement:
 *   • Write  → text → /api/jingles/generate → local Preview → Regenerate → Save (shared cloud library)
 *   • Record → the phone's mic (shared useVoiceRecorder) → local Preview  (saving a recording is gated)
 *
 * TWO STRICTLY SEPARATED AUDIO PATHS (per product rule):
 *   • PREVIEW  = LOCAL PHONE ONLY — a private <audio> element. Even in CONTROL mode it NEVER sends
 *     PLAY / PLAY_SOURCE / PLAY_INTERRUPT / WS. The branch music is never touched by a preview.
 *   • PAD PLAY = the branch MASTER, via the EXISTING remote command `sendCommandToMaster("PLAY_INTERRUPT")`
 *     (same path the desktop web controller uses). The audio plays on the branch player, not the phone.
 *
 * Pads are the SHARED Cloud Pads (same 8 as the desktop) — no separate mobile pad state.
 */

type Language = "en" | "he";
type Mode = "write" | "record";
type GenerateResult = { url: string; durationLabel: string };

/** "m:ss" → seconds (for the library durationSec field). Tolerates a bare number. */
function labelToSec(label?: string): number | null {
  if (!label) return null;
  const m = /^(\d+):(\d{1,2})$/.exec(label.trim());
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const n = Number(label);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}
function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Per-pad color → button classes (mobile). Full literal strings so Tailwind keeps them in the build. */
const PAD_COLOR_CLASSES: Record<string, { assigned: string; empty: string; dot: string }> = {
  default: { assigned: "border-slate-600 bg-slate-700/40 active:bg-slate-700/60", empty: "border-slate-800 bg-slate-900/40", dot: "bg-slate-400" },
  sky:     { assigned: "border-sky-500/60 bg-sky-500/15 active:bg-sky-500/25", empty: "border-sky-500/25 bg-sky-500/[0.06]", dot: "bg-sky-400" },
  violet:  { assigned: "border-violet-500/60 bg-violet-500/15 active:bg-violet-500/25", empty: "border-violet-500/25 bg-violet-500/[0.06]", dot: "bg-violet-400" },
  pink:    { assigned: "border-pink-500/60 bg-pink-500/15 active:bg-pink-500/25", empty: "border-pink-500/25 bg-pink-500/[0.06]", dot: "bg-pink-400" },
  amber:   { assigned: "border-amber-500/60 bg-amber-500/15 active:bg-amber-500/25", empty: "border-amber-500/25 bg-amber-500/[0.06]", dot: "bg-amber-400" },
  rose:    { assigned: "border-rose-500/60 bg-rose-500/15 active:bg-rose-500/25", empty: "border-rose-500/25 bg-rose-500/[0.06]", dot: "bg-rose-400" },
  teal:    { assigned: "border-teal-500/60 bg-teal-500/15 active:bg-teal-500/25", empty: "border-teal-500/25 bg-teal-500/[0.06]", dot: "bg-teal-400" },
  lime:    { assigned: "border-lime-500/60 bg-lime-500/15 active:bg-lime-500/25", empty: "border-lime-500/25 bg-lime-500/[0.06]", dot: "bg-lime-400" },
  indigo:  { assigned: "border-indigo-500/60 bg-indigo-500/15 active:bg-indigo-500/25", empty: "border-indigo-500/25 bg-indigo-500/[0.06]", dot: "bg-indigo-400" },
};

/** Pre-roll bell choices — mirrors the desktop JingleBellStyle set. */
const BELL_OPTIONS: { value: JingleBellStyle; label: string }[] = [
  { value: "off", label: "No bell" },
  { value: "ding", label: "Ding" },
  { value: "chime", label: "Chime" },
  { value: "soft", label: "Soft" },
];

export function MobileJingles() {
  const [mode, setMode] = useState<Mode>("write");

  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [language, setLanguage] = useState<Language>("en"); // mirror the desktop default
  const [voiceId, setVoiceId] = useState<string>(VOICE_PRESETS_BY_LANG.en[0].voiceId);

  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Shared Cloud Pads (same board as the desktop). assignMode = tap a pad to assign the saved jingle.
  const [pads, setPads] = useState<SamplerPadItem[]>([]);
  const [assignMode, setAssignMode] = useState(false);
  const [padMsg, setPadMsg] = useState<string | null>(null);
  const [padBusy, setPadBusy] = useState<string | null>(null);
  const [bellStyle, setBellStyle] = useState<JingleBellStyle>("off"); // pre-roll bell applied when assigning to a pad

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const generatingRef = useRef(false);
  const savingRef = useRef(false);
  const padsRef = useRef<HTMLElement | null>(null);

  const recorder = useVoiceRecorder();
  const deviceCtx = useDevicePlayer();

  const refreshPads = useCallback(async () => {
    try {
      setPads(padsFromCloud(await fetchCloudPads()));
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    void refreshPads();
  }, [refreshPads]);

  const selectLanguage = useCallback((code: Language) => {
    setLanguage(code);
    setVoiceId(VOICE_PRESETS_BY_LANG[code][0].voiceId);
  }, []);

  const stopPreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setPlaying(false);
  }, []);

  useEffect(() => {
    return () => {
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

  // After Save, bring the "Choose a Pad" step into view so the assign flow is obvious.
  useEffect(() => {
    if (assignMode) padsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [assignMode]);

  const handleGenerate = useCallback(async () => {
    if (generatingRef.current) return; // guard against double-tap
    const text = script.trim();
    if (!text) {
      setError("Type what the announcer should say.");
      return;
    }
    generatingRef.current = true;
    setGenerating(true);
    setError(null);
    stopPreview();
    setResult(null);
    setSaved(false);
    setAssignMode(false);
    try {
      const res = await fetch("/api/jingles/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, ...(voiceId ? { voiceId } : {}), language, speed: "normal" }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; durationLabel?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ? `Couldn't create the jingle: ${data.error}` : `Couldn't create the jingle (HTTP ${res.status}).`);
        return;
      }
      setResult({ url: data.url, durationLabel: data.durationLabel ?? "—" });
    } catch (e) {
      setError(`Couldn't create the jingle: ${e instanceof Error ? e.message : "network error"}`);
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }, [script, voiceId, language, stopPreview]);

  // ── LOCAL preview only (this phone). No PLAY command is ever sent. ──
  const togglePreview = useCallback(() => {
    if (!result?.url) return;
    if (!audioRef.current) {
      const a = new Audio();
      a.onended = () => setPlaying(false);
      a.onpause = () => setPlaying(false);
      audioRef.current = a;
    }
    const a = audioRef.current;
    if (playing) {
      a.pause();
      a.currentTime = 0;
      setPlaying(false);
    } else {
      a.src = result.url;
      void a.play().then(() => setPlaying(true)).catch(() => setError("Preview couldn't play on this device."));
    }
  }, [result, playing]);

  const derivedTitle = useCallback(
    () => title.trim() || script.trim().slice(0, 48) || "Mobile jingle",
    [title, script],
  );

  const handleSave = useCallback(async () => {
    if (savingRef.current || saved || !result?.url) return; // guard against duplicate save
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/jingles/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: derivedTitle(),
          url: result.url,
          ...(voiceId ? { voiceId } : {}),
          script: script.trim(),
          durationSec: labelToSec(result.durationLabel),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ? `Couldn't save: ${data.error}` : `Couldn't save (HTTP ${res.status}).`);
        return;
      }
      setSaved(true);
      setAssignMode(true); // → the pads section switches to "Choose a Pad" and scrolls into view
      setPadMsg(null);
    } catch (e) {
      setError(`Couldn't save: ${e instanceof Error ? e.message : "network error"}`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [result, derivedTitle, script, voiceId, saved]);

  // ── Pad tap: assign the saved jingle, OR play the pad on the branch MASTER (never on the phone). ──
  const handlePadTap = useCallback(
    async (pad: SamplerPadItem) => {
      // Assign mode (right after Save): tap any pad to assign the saved jingle to it (shared Cloud Pads).
      // In this mode a pad tap ONLY assigns — it never plays.
      if (assignMode && result?.url) {
        const chosen = pad.label; // the pad the user tapped (before we overwrite its label)
        setPadBusy(pad.id);
        try {
          await savePadToCloud({
            ...pad,
            label: derivedTitle().slice(0, 20),
            url: result.url,
            bellStyle,
            preRoll: bellStyle !== "off",
          });
          await refreshPads();
          setAssignMode(false);
          setPadMsg(`✓ Assigned to the “${chosen}” pad.`);
        } catch {
          setPadMsg("Couldn't assign to that pad. Try again.");
        } finally {
          setPadBusy(null);
        }
        return;
      }
      // Normal tap: play the pad on the branch MASTER via the EXISTING remote command. Not on the phone.
      if (pad.url && pad.url.trim()) {
        if (deviceCtx?.sendCommandToMaster) {
          deviceCtx.sendCommandToMaster("PLAY_INTERRUPT", { url: pad.url });
          setPadMsg(`Sent “${pad.label}” to the branch player ▶`);
        } else {
          setPadMsg("Connect to a branch player to play pads.");
        }
      } else {
        setPadMsg("This pad is empty. Save a jingle, then tap a pad to assign it.");
      }
    },
    [assignMode, result, derivedTitle, refreshPads, deviceCtx, bellStyle],
  );

  const recPhase = recorder.phase;

  return (
    <>
      <MobilePageHeader title="Jingles" />

      <div className="px-4 py-4 pb-28">
        {/* Mode: Write (text→voice) or Record (your voice) */}
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-slate-900/40 p-1">
          {([["write", "Write"], ["record", "Record"]] as const).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                mode === m ? "bg-sky-500 text-white" : "text-slate-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "write" ? (
          <>
            <p className="mb-4 text-sm leading-relaxed text-slate-400">
              Write a message, pick a voice, and generate a professional announcer take. Preview it on
              your phone, then save it to your Jingle Library.
            </p>

            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Title <span className="text-slate-600">(optional)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Closing soon"
              className="mb-4 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3.5 py-3 text-base text-slate-100 placeholder:text-slate-600 focus:border-sky-500/60 focus:outline-none"
            />

            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Language</label>
            <div className="mb-4 grid grid-cols-2 gap-2">
              {([["he", "Hebrew"], ["en", "English"]] as const).map(([code, label]) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => selectLanguage(code)}
                  aria-pressed={language === code}
                  className={`rounded-xl border px-3 py-3 text-sm font-medium transition-colors ${
                    language === code
                      ? "border-sky-500/60 bg-sky-500/15 text-sky-200"
                      : "border-slate-800 bg-slate-900/50 text-slate-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Voice</label>
            <select
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              className="mb-4 w-full appearance-none rounded-xl border border-slate-800 bg-slate-900/60 px-3.5 py-3 text-base text-slate-100 focus:border-sky-500/60 focus:outline-none"
            >
              {VOICE_PRESETS_BY_LANG[language].map((v) => (
                <option key={v.voiceId} value={v.voiceId}>
                  {v.label}
                </option>
              ))}
            </select>

            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Message</label>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="Attention shoppers: our bakery is fresh out of the oven…"
              rows={6}
              className="mb-4 min-h-[160px] w-full resize-y rounded-xl border border-slate-800 bg-slate-900/60 px-3.5 py-3 text-base leading-relaxed text-slate-100 placeholder:text-slate-600 focus:border-sky-500/60 focus:outline-none"
            />

            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={generating || !script.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 px-4 py-4 text-base font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {generating ? (
                <>
                  <span className="mj-spin inline-block h-4 w-4 rounded-full border-2 border-white/30 border-t-white" />
                  Generating…
                </>
              ) : result ? (
                "Regenerate"
              ) : (
                "Generate"
              )}
            </button>

            {error ? (
              <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-3 text-sm text-rose-300">
                {error}
              </div>
            ) : null}

            {result ? (
              <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-200">Your jingle</span>
                  <span className="text-xs tabular-nums text-slate-500">{result.durationLabel}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={togglePreview} className="rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-3 text-sm font-medium text-slate-100">
                    {playing ? "■ Stop" : "▶ Listen"}
                  </button>
                  <button type="button" onClick={() => void handleGenerate()} disabled={generating} className="rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-3 text-sm font-medium text-slate-100 disabled:opacity-50">
                    ↺ Regenerate
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || saved}
                  className={`mt-2 w-full rounded-xl px-4 py-3.5 text-sm font-semibold transition-colors ${
                    saved ? "cursor-default bg-emerald-500/15 text-emerald-300" : "bg-slate-100 text-slate-900 disabled:opacity-60"
                  }`}
                >
                  {saved ? "✓ Saved to your Jingles Library" : saving ? "Saving…" : "Save to Jingle Library"}
                </button>
                {saved ? (
                  <p className="mt-3 text-center text-xs font-medium text-sky-300">Now choose a Pad below to assign it ↓</p>
                ) : (
                  <p className="mt-3 text-center text-xs text-slate-600">
                    Preview plays on this phone only — the branch music isn’t affected.
                  </p>
                )}
              </div>
            ) : null}
          </>
        ) : (
          /* Record mode — the phone's mic, local preview only. */
          <>
            <p className="mb-5 text-sm leading-relaxed text-slate-400">
              Record your own announcement with the phone’s microphone and listen back here. Playback is
              on this phone only.
            </p>
            <div className="flex flex-col items-center gap-5 rounded-2xl border border-slate-800 bg-slate-900/40 py-8">
              <div className="text-3xl font-light tabular-nums text-slate-100">
                {recPhase === "idle" ? "Ready" : fmt(recorder.elapsed)}
              </div>
              <button
                type="button"
                onClick={() => (recPhase === "recording" ? recorder.stopRecording() : void recorder.startRecording())}
                aria-label={recPhase === "recording" ? "Stop recording" : "Start recording"}
                className={`flex h-28 w-28 items-center justify-center rounded-full border-2 transition-colors ${
                  recPhase === "recording" ? "border-rose-500 bg-rose-500/10" : "border-slate-600 bg-slate-800/60"
                }`}
              >
                <span className={recPhase === "recording" ? "h-8 w-8 rounded bg-rose-500" : "h-12 w-12 rounded-full bg-rose-500"} />
              </button>
              <div className="text-sm text-slate-400">
                {recPhase === "recording" ? "Recording… tap to stop" : recPhase === "recorded" ? "Nice take." : "Tap to record"}
              </div>
              {recPhase === "recorded" ? (
                <div className="flex gap-2">
                  <button type="button" onClick={recorder.togglePreview} className="rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2.5 text-sm font-medium text-slate-100">
                    {recorder.playing ? "■ Stop" : "▶ Listen"}
                  </button>
                  <button type="button" onClick={recorder.reset} className="rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2.5 text-sm font-medium text-slate-100">
                    ↺ Re-record
                  </button>
                </div>
              ) : null}
            </div>
            {recorder.error ? (
              <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-3 text-sm text-rose-300">
                {recorder.error}
              </div>
            ) : null}
            <p className="mt-3 text-center text-xs text-slate-600">
              Saving a recorded take to the library is coming soon. For now, use “Write” to create a
              savable jingle.
            </p>
          </>
        )}

        {/* Shared pads — the SAME board as the desktop. Normal tap = play on the branch MASTER
            (not the phone). In assign mode (right after Save) a tap ONLY assigns, never plays. */}
        <section ref={padsRef} className="mt-8 scroll-mt-4">
          {assignMode ? (
            <div className="mb-3 rounded-2xl border border-sky-500/40 bg-sky-500/10 px-4 py-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-sky-200">Choose a Pad</h2>
                <button type="button" onClick={() => { setAssignMode(false); setPadMsg(null); }} className="text-xs font-medium text-sky-300">
                  Skip
                </button>
              </div>
              <p className="mt-0.5 text-xs text-sky-100/80">Tap a pad to assign “{derivedTitle().slice(0, 20)}”. It won’t play — assign only.</p>
              <div className="mt-3">
                <span className="text-[11px] font-medium uppercase tracking-wide text-sky-200/70">Pre-roll bell</span>
                <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                  {BELL_OPTIONS.map((b) => (
                    <button
                      key={b.value}
                      type="button"
                      onClick={() => setBellStyle(b.value)}
                      aria-pressed={bellStyle === b.value}
                      className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
                        bellStyle === b.value
                          ? "border-sky-400 bg-sky-400/20 text-sky-100"
                          : "border-sky-500/25 bg-transparent text-sky-200/70 active:bg-sky-500/10"
                      }`}
                    >
                      {b.value === "off" ? "🔕" : "🔔"} {b.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <h2 className="mb-3 text-sm font-semibold tracking-tight text-slate-200">Pads</h2>
          )}

          {padMsg ? (
            <p className="mb-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300">{padMsg}</p>
          ) : null}

          {pads.length === 0 ? (
            <p className="text-xs text-slate-500">
              Your pads sync from the workspace. Assign jingles to pads and they’ll show here.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {pads.map((p) => {
                const assigned = !!(p.url && p.url.trim());
                const busy = padBusy === p.id;
                const palette = PAD_COLOR_CLASSES[(p.color as string | undefined) ?? "default"] ?? PAD_COLOR_CLASSES.default;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => void handlePadTap(p)}
                    disabled={busy}
                    className={`rounded-xl border px-3 py-3 text-left transition-colors disabled:opacity-60 ${
                      assignMode
                        ? "border-sky-500/60 bg-sky-500/15 active:bg-sky-500/25"
                        : assigned
                          ? palette.assigned
                          : palette.empty
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${assigned ? palette.dot : "bg-slate-600"}`} />
                      <span className="truncate text-sm text-slate-100">{p.label}</span>
                    </div>
                    <span className="mt-1 block text-[11px] text-slate-500">
                      {assignMode ? "Tap to assign here" : busy ? "Assigning…" : assigned ? "Tap to play on branch ▶" : "Empty"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {!assignMode ? (
            <p className="mt-2 text-[11px] text-slate-600">
              The same pads as the desktop. Tapping a pad plays it on the branch player, not this phone.
            </p>
          ) : null}
        </section>
      </div>

      <style>{`
        @keyframes mj-spin { to { transform: rotate(360deg) } }
        .mj-spin { animation: mj-spin .8s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .mj-spin { animation: none; } }
      `}</style>
    </>
  );
}

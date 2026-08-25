"use client";

/**
 * USER-facing "Suggest info" control next to a track. A regular user proposes PUBLIC metadata;
 * it is saved as a PENDING contribution for later ADMIN review. It NEVER edits the official
 * catalog or any music file, and NEVER shows private data (comments/filename/localRef/metadataHash).
 * The form starts BLANK — it only collects what the user types.
 */

import { useState, type ReactElement } from "react";
import { createPortal } from "react-dom";

type Props = { trackTitle?: string | null; trackArtist?: string | null; catalogItemId?: string | null };
type Phase = { kind: "idle" } | { kind: "saving" } | { kind: "ok" } | { kind: "error"; message: string };

const ENERGY = ["", "LOW", "MEDIUM", "HIGH"];

export function SuggestMetadataButton({ trackTitle, trackArtist, catalogItemId }: Props): ReactElement {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [greatTrack, setGreatTrack] = useState(false);
  const [form, setForm] = useState({ genre: "", mood: "", energy: "", daypart: "", businessType: "", publicTags: "", note: "" });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const close = () => { setOpen(false); setPhase({ kind: "idle" }); };

  const submit = async () => {
    setPhase({ kind: "saving" });
    try {
      const res = await fetch("/api/contributions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackTitle: trackTitle ?? null, trackArtist: trackArtist ?? null,
          catalogItemId: catalogItemId ?? null, greatTrack,
          genre: form.genre, mood: form.mood, energy: form.energy, daypart: form.daypart,
          businessType: form.businessType, note: form.note,
          publicTags: form.publicTags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      // Parse defensively: an empty/non-JSON body (e.g. an unexpected 500) must not surface as
      // "Unexpected end of JSON input" — fall back to a status-based message instead.
      const raw = await res.text();
      let j: { ok?: boolean; error?: string } = {};
      if (raw) { try { j = JSON.parse(raw); } catch { j = {}; } }
      if (!res.ok) throw new Error(j.error ?? `Could not save your suggestion (HTTP ${res.status}).`);
      setPhase({ kind: "ok" });
    } catch (e) { setPhase({ kind: "error", message: (e as Error).message }); }
  };

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <>
      <button
        type="button"
        onClick={(e) => { stop(e); setOpen(true); }}
        className="mt-1 inline-flex items-center gap-1 rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] font-medium text-slate-300 hover:border-white/20 hover:bg-white/5"
        title="Suggest info for this track (sent for review)"
        aria-label="Suggest info for this track"
      >
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
        Suggest info
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div onClick={close} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
          <div onClick={stop} className="max-h-[calc(100dvh-2rem)] w-full max-w-[460px] overflow-y-auto rounded-2xl border border-white/10 bg-[#141418] text-[var(--sb-text,#f5f5f7)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
              <div className="min-w-0">
                <h3 className="text-[14px] font-semibold">Suggest info</h3>
                <p className="truncate text-[11px] text-[var(--sb-text-dim,#8a8a90)]">{[trackTitle, trackArtist].filter(Boolean).join(" — ") || "This track"}</p>
              </div>
              <button onClick={close} className="rounded-lg px-2 py-1 text-[13px] hover:bg-white/5" aria-label="Close">✕</button>
            </div>

            {phase.kind === "ok" ? (
              <div className="flex flex-col items-center gap-2 p-8 text-center">
                <div className="text-[26px]">🙌</div>
                <div className="text-[14px] font-semibold">Thanks — your suggestion was sent for review.</div>
                <p className="text-[12px] text-[var(--sb-text-dim,#8a8a90)]">It’s pending. An admin will approve or decline it. Nothing was changed yet.</p>
                <button onClick={close} className="mt-2 rounded-lg bg-[#0a84ff] px-4 py-1.5 text-[13px] font-medium text-white">Done</button>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 p-5">
                <button
                  type="button"
                  onClick={() => setGreatTrack((v) => !v)}
                  aria-pressed={greatTrack}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-[13px] font-semibold transition-colors ${
                    greatTrack
                      ? "border-amber-400/60 bg-amber-400/10 text-amber-300"
                      : "border-white/10 bg-black/20 text-slate-300 hover:border-white/20"
                  }`}
                >
                  <span aria-hidden className="text-[15px] leading-none">{greatTrack ? "⭐" : "☆"}</span>
                  This is a great track
                </button>
                <Field label="Genre"><input value={form.genre} onChange={set("genre")} className={inputCls} placeholder="e.g. Soul" /></Field>
                <Field label="Mood"><input value={form.mood} onChange={set("mood")} className={inputCls} placeholder="e.g. Warm" /></Field>
                <Field label="Energy">
                  <select value={form.energy} onChange={set("energy")} className={inputCls}>
                    {ENERGY.map((v) => <option key={v} value={v}>{v || "—"}</option>)}
                  </select>
                </Field>
                <Field label="Daypart"><input value={form.daypart} onChange={set("daypart")} className={inputCls} placeholder="e.g. Evening" /></Field>
                <Field label="Business type"><input value={form.businessType} onChange={set("businessType")} className={inputCls} placeholder="e.g. Café" /></Field>
                <Field label="Public tags"><input value={form.publicTags} onChange={set("publicTags")} className={inputCls} placeholder="comma, separated" /></Field>
                <Field label="Note (optional)"><textarea value={form.note} onChange={set("note")} rows={2} className={inputCls} placeholder="Anything else…" /></Field>

                {phase.kind === "error" && <div className="rounded-lg bg-red-500/10 px-3 py-1.5 text-[12px] text-red-400">{phase.message}</div>}
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[10px] text-[var(--sb-text-dim,#8a8a90)]">Saved as a suggestion — reviewed by an admin.</span>
                  <button onClick={submit} disabled={phase.kind === "saving"} className="rounded-lg bg-[#0a84ff] px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-50">
                    {phase.kind === "saving" ? "Sending…" : "Send suggestion"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

const inputCls = "w-full rounded-lg border border-[var(--sb-border,#2a2a2e)] bg-black/30 px-2.5 py-1.5 text-[13px] outline-none focus:border-[#0a84ff]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-[var(--sb-text-dim,#a8a8ae)]">{label}</span>
      {children}
    </label>
  );
}

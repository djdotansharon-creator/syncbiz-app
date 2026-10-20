"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { radioToUnified } from "@/lib/radio-utils";
import { addRadioStationLocal } from "@/lib/radio-local-store";
import { RadioIcon } from "@/components/ui/radio-icon";
import type { RadioStream } from "@/lib/source-types";

type Preset = { key: string; name: string; genre: string; url: string; cover: string | null };

type Props = {
  /** The workspace's saved stations — a preset already saved plays that row instead of adding a duplicate. */
  stations: RadioStream[];
  onAdded: () => void;
};

/** "Israeli stations" — default stations for workspaces in Israel (see /api/radio/presets). Renders nothing elsewhere. */
export function RadioPresetsSection({ stations, onAdded }: Props) {
  const router = useRouter();
  const { locale } = useLocale();
  const { playSource } = usePlayback();
  const he = locale === "he";
  const [presets, setPresets] = useState<Preset[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/radio/presets")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { stations?: Preset[] } | null) => {
        if (!cancelled && Array.isArray(data?.stations)) setPresets(data.stations);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const savedFor = useCallback(
    (p: Preset) => stations.find((s) => s.url === p.url || s.name === p.name) ?? null,
    [stations],
  );

  const save = useCallback(async (p: Preset): Promise<RadioStream | null> => {
    const res = await fetch("/api/radio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: p.name, url: p.url, genre: p.genre, cover: p.cover }),
    });
    if (!res.ok) return null;
    const station = (await res.json()) as RadioStream;
    addRadioStationLocal(station);
    return station;
  }, []);

  const handleAdd = useCallback(
    async (p: Preset) => {
      setBusyKey(p.key);
      try {
        if (await save(p)) {
          router.refresh();
          onAdded();
        }
      } finally {
        setBusyKey(null);
      }
    },
    [save, router, onAdded],
  );

  const handlePlay = useCallback(
    async (p: Preset) => {
      const existing = savedFor(p);
      if (existing) {
        playSource(radioToUnified(existing));
        return;
      }
      setBusyKey(p.key);
      try {
        const station = await save(p);
        if (station) {
          playSource(radioToUnified(station));
          router.refresh();
          onAdded();
        }
      } finally {
        setBusyKey(null);
      }
    },
    [savedFor, save, playSource, router, onAdded],
  );

  if (presets.length === 0) return null;

  return (
    <section aria-labelledby="radio-presets-title" className="space-y-3">
      <h2 id="radio-presets-title" className="text-sm font-semibold text-slate-200">
        {he ? "תחנות ישראליות" : "Israeli stations"}
      </h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {presets.map((p) => {
          const saved = savedFor(p);
          const busy = busyKey === p.key;
          return (
            <div
              key={p.key}
              className="flex items-center gap-3 rounded-xl border border-slate-800/80 bg-slate-950/40 px-3 py-2.5"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-700/70">
                {p.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.cover} alt="" className="h-full w-full object-cover" />
                ) : (
                  <RadioIcon className="h-5 w-5 text-slate-100" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-100">{p.name}</p>
                <p className="truncate text-xs text-slate-500">{p.genre}</p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handlePlay(p)}
                aria-label={he ? `נגן ${p.name}` : `Play ${p.name}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-slate-900 transition hover:bg-slate-200 disabled:opacity-50"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
              {saved ? (
                <span className="shrink-0 text-xs text-slate-500">{he ? "בספרייה" : "Saved"}</span>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleAdd(p)}
                  className="shrink-0 rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 disabled:opacity-50"
                >
                  {he ? "הוסף" : "Add"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

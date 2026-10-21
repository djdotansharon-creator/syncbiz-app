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
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
        {presets.map((p) => {
          const saved = savedFor(p);
          const busy = busyKey === p.key;
          return (
            <div key={p.key} className="group min-w-0">
              <div className="relative aspect-square overflow-hidden rounded-2xl bg-slate-700/70 ring-1 ring-slate-800/80 transition group-hover:ring-slate-600">
                {p.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.cover}
                    alt=""
                    className="h-full w-full object-contain p-2"
                    onError={(e) => (e.currentTarget.src = "/radio-default.svg")}
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center">
                    <RadioIcon className="h-8 w-8 text-slate-100" />
                  </span>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handlePlay(p)}
                  aria-label={he ? `נגן ${p.name}` : `Play ${p.name}`}
                  className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/40 focus-visible:bg-black/40 focus-visible:outline-none disabled:cursor-wait"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-900 shadow-lg transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                    <svg className="h-4 w-4 ml-0.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </button>
              </div>
              <p className="mt-1.5 truncate text-xs font-medium text-slate-100">{p.name}</p>
              {saved ? (
                <p className="text-[11px] text-slate-500">✓ {he ? "בספרייה" : "Saved"}</p>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleAdd(p)}
                  className="text-[11px] font-medium text-sky-400 transition hover:text-sky-300 disabled:opacity-50"
                >
                  + {he ? "הוסף" : "Add"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

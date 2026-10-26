"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { RadioArt } from "@/components/radio-art";
import { radioToUnified } from "@/lib/radio-utils";
import { addRadioStationLocal } from "@/lib/radio-local-store";
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
    <section aria-labelledby="radio-presets-title">
      <h2 id="radio-presets-title" className="sb-rad-title">
        {he ? "תחנות ישראליות" : "Israeli stations"}
      </h2>
      <div className="sb-rad-grid">
        {presets.map((p) => {
          const saved = savedFor(p);
          const busy = busyKey === p.key;
          return (
            <div key={p.key} className="sb-rad-tile" data-busy={busy ? "1" : undefined}>
              <div className="sb-rad-art">
                <RadioArt cover={p.cover} />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handlePlay(p)}
                  aria-label={he ? `נגן ${p.name}` : `Play ${p.name}`}
                  className="sb-rad-hit"
                >
                  <span className="sb-rad-glyph">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden style={{ marginInlineStart: 2 }}>
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </button>
              </div>
              <p className="sb-rad-name" dir="auto" title={p.name}>{p.name}</p>
              {saved ? (
                <p className="sb-rad-sub">✓ {he ? "בספרייה" : "Saved"}</p>
              ) : (
                <button type="button" disabled={busy} onClick={() => void handleAdd(p)} className="sb-rad-addlink">
                  + {he ? "הוסיפו" : "Add"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

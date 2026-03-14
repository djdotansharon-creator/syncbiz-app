"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "@/lib/locale-context";
import { labels } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { radioToUnified } from "@/lib/radio-utils";
import { RadioSearchBar } from "@/components/radio-search-bar";
import { RadioIcon } from "@/components/ui/radio-icon";
import { NeonControlButton } from "@/components/ui/neon-control-button";
import { ActionButtonShare, ActionButtonEdit } from "@/components/ui/action-buttons";
import { ShareModal } from "@/components/share-modal";
import { radioToShareable } from "@/lib/share-utils";
import { getRadioStationsLocal, removeRadioStationLocal } from "@/lib/radio-local-store";
import type { RadioStream } from "@/lib/source-types";

type Props = {
  initialStations: RadioStream[];
};

function mergeStations(server: RadioStream[], local: RadioStream[]): RadioStream[] {
  const byId = new Map<string, RadioStream>();
  for (const s of server) byId.set(s.id, s);
  for (const s of local) if (!byId.has(s.id)) byId.set(s.id, s);
  return [...byId.values()];
}

export function RadioStreamsManager({ initialStations }: Props) {
  const router = useRouter();
  const { locale } = useLocale();
  const { t } = useTranslations();
  const { setQueue } = usePlayback();
  const [stations, setStations] = useState<RadioStream[]>(initialStations);

  useEffect(() => {
    const merged = mergeStations(initialStations, getRadioStationsLocal());
    setStations(merged);
    setQueue(merged.map(radioToUnified));
  }, [initialStations, setQueue]);

  const handleAdd = () => {
    router.refresh();
  };

  const handleRemove = useCallback((id: string) => {
    setStations((prev) => prev.filter((s) => s.id !== id));
    removeRadioStationLocal(id);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/sources"
            className="flex h-9 items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 text-sm font-medium text-slate-200 transition hover:border-slate-700 hover:bg-slate-800/80 hover:text-slate-100"
          >
            {t.library}
          </Link>
          <Link
            href="/favorites"
            className="flex h-9 items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 text-sm font-medium text-slate-200 transition hover:border-slate-700 hover:bg-slate-800/80 hover:text-slate-100"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            {t.favorites}
          </Link>
          <Link
            href="/radio"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 text-xs font-semibold uppercase tracking-wider text-sky-300"
            aria-current="page"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
            {labels.radio?.[locale] ?? "Radio"}
          </Link>
        </div>
      </div>

      <RadioSearchBar onAdd={handleAdd} />

      {stations.length === 0 ? (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/40 py-16 text-center text-sm text-slate-500">
          {t.radioNoStations}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/40 divide-y divide-slate-800/60 overflow-hidden">
          {stations.map((station) => (
            <RadioStreamRow key={station.id} station={station} onRemove={handleRemove} />
          ))}
        </div>
      )}
    </div>
  );
}

function RadioStreamRow({ station, onRemove }: { station: RadioStream; onRemove: (id: string) => void }) {
  const { playSource, stop, pause, currentSource } = usePlayback();
  const { t } = useTranslations();
  const [shareOpen, setShareOpen] = useState(false);
  const unified = radioToUnified(station);
  const active = currentSource?.id === station.id;
  const DEFAULT_IMAGE = "/radio-default.svg";
  const cover = station.cover || DEFAULT_IMAGE;

  return (
    <div
      className={`flex items-center gap-4 rounded-xl px-4 py-3 transition-all hover:bg-slate-900/40 ${
        active ? "playing-active bg-slate-900/60" : ""
      }`}
    >
      {/* Image left */}
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-800">
        {cover ? (
          <img src={cover} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.src = DEFAULT_IMAGE)} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-rose-400/70">
            <RadioIcon className="h-7 w-7" />
          </div>
        )}
        <span
          className={`absolute top-1 right-1 rounded px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-white ${
            active ? "bg-red-500 animate-pulse shadow-[0_0_6px_rgba(239,68,68,0.8)]" : "bg-rose-500/90"
          }`}
        >
          {t.live ?? "LIVE"}
        </span>
      </div>
      {/* Details opposite image */}
      <div className="min-w-0 flex-1 flex items-center gap-3">
        <span className="truncate font-medium text-slate-100">{station.name}</span>
        {station.genre && <span className="text-xs text-slate-500">{station.genre}</span>}
        <RadioIcon className="h-5 w-5 shrink-0 text-rose-400/80" />
      </div>
      {/* Spacer to center controls */}
      <div className="flex-1 min-w-0" />
      {/* Controls centered */}
      <div className="flex flex-nowrap items-center gap-2 shrink-0" role="group" aria-label="Radio controls">
        {active && (
          <>
            <NeonControlButton size="sm" onClick={stop} title="Stop" aria-label="Stop">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </NeonControlButton>
            <NeonControlButton size="md" onClick={() => playSource(unified)} active title="Play" aria-label="Play">
              <svg className="h-5 w-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7L8 5z" />
              </svg>
            </NeonControlButton>
            <NeonControlButton size="sm" onClick={pause} active title="Pause" aria-label="Pause">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            </NeonControlButton>
          </>
        )}
        {!active && (
          <NeonControlButton size="md" onClick={() => playSource(unified)} title="Play" aria-label="Play">
            <svg className="h-5 w-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7L8 5z" />
            </svg>
          </NeonControlButton>
        )}
        <ActionButtonShare variant="player" onClick={() => setShareOpen(true)} title={t.share} aria-label={t.share} />
        <ActionButtonEdit href={`/radio/${station.id}/edit`} variant="player" title={t.edit} aria-label={t.edit} />
      </div>
      <div className="flex-1 min-w-0" />
      {shareOpen && (
        <ShareModal
          item={radioToShareable(station)}
          fallbackRadioId={station.id}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}

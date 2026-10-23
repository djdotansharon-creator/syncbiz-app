"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "@/lib/locale-context";
import { labels } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { radioToUnified } from "@/lib/radio-utils";
import { RadioSearchBar } from "@/components/radio-search-bar";
import { RadioPresetsSection } from "@/components/radio-presets-section";
import { NeonControlButton } from "@/components/ui/neon-control-button";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { ShareModal } from "@/components/share-modal";
import { radioToShareable } from "@/lib/share-utils";
import { getRadioStationsLocal, removeRadioStationLocal } from "@/lib/radio-local-store";
import { useRadioNowPlaying } from "@/lib/use-radio-now-playing";
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
  const searchRef = useRef<HTMLDivElement>(null);
  const he = locale === "he";

  useEffect(() => {
    const merged = mergeStations(initialStations, getRadioStationsLocal());
    setStations(merged);
    setQueue(merged.map(radioToUnified));
  }, [initialStations, setQueue]);

  const handleAdd = () => {
    router.refresh();
  };

  const focusSearch = useCallback(() => {
    searchRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    searchRef.current?.querySelector("input")?.focus({ preventScroll: true });
  }, []);

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
            {(labels.radio as Record<string, string> | undefined)?.[locale] ?? "Radio"}
          </Link>
        </div>
      </div>

      <div ref={searchRef}>
        <RadioSearchBar onAdd={handleAdd} />
      </div>

      <RadioNowPlaying stations={stations} />

      <RadioPresetsSection stations={stations} onAdded={handleAdd} />

      <section aria-labelledby="my-stations-title" className="space-y-3">
        <h2 id="my-stations-title" className="text-sm font-semibold text-slate-200">
          {he ? "התחנות שלי" : "My stations"}
        </h2>
        {stations.length === 0 && (
          <p className="text-sm text-slate-500">{t.radioNoStations}</p>
        )}
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {stations.map((station) => (
            <RadioStationTile key={station.id} station={station} onRemove={handleRemove} />
          ))}
          <button
            type="button"
            onClick={focusSearch}
            className="flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-700/80 text-slate-400 transition hover:border-slate-500 hover:bg-slate-900/40 hover:text-slate-200"
          >
            <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span className="text-sm font-medium">{he ? "הוסף תחנה" : "Add station"}</span>
          </button>
        </div>
      </section>
    </div>
  );
}

const DEFAULT_IMAGE = "/radio-default.svg";

function PlayGlyph({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}

function PauseGlyph({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}

/** "Now playing" card — shown while one of this workspace's stations is the current source. */
function RadioNowPlaying({ stations }: { stations: RadioStream[] }) {
  const { playSource, stop, pause, currentSource, status } = usePlayback();
  const { t } = useTranslations();
  const { locale } = useLocale();
  const station = stations.find((s) => s.id === currentSource?.id);
  const playing = status === "playing";
  const song = useRadioNowPlaying(station?.id ?? null, playing);
  if (!station) return null;

  return (
    <div className="playing-active flex items-center gap-4 rounded-2xl border border-rose-500/30 bg-gradient-to-l from-rose-950/30 via-slate-900/70 to-slate-950/80 p-4">
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-800">
        <img src={station.cover || DEFAULT_IMAGE} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.src = DEFAULT_IMAGE)} />
      </div>
      <div className="min-w-0 flex-1">
        <span className="inline-flex items-center gap-1.5 rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
          <span className={`h-1.5 w-1.5 rounded-full bg-white ${playing ? "animate-pulse" : ""}`} />
          {t.live ?? "LIVE"}
        </span>
        <p className="mt-1 truncate text-lg font-semibold text-slate-100">{station.name}</p>
        {song && (
          <p className="truncate text-sm font-medium text-rose-200/90" title={song}>
            ♪ {song}
          </p>
        )}
        <p className="truncate text-xs text-slate-400">
          {locale === "he" ? "מתנגן עכשיו" : "Now playing"}
          {station.genre ? ` · ${station.genre}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2" role="group" aria-label="Radio controls">
        <NeonControlButton size="sm" onClick={stop} title="Stop" aria-label="Stop">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
        </NeonControlButton>
        {playing ? (
          <NeonControlButton size="md" onClick={pause} active title="Pause" aria-label="Pause">
            <PauseGlyph className="h-5 w-5" />
          </NeonControlButton>
        ) : (
          <NeonControlButton size="md" onClick={() => playSource(radioToUnified(station))} active title="Play" aria-label="Play">
            <PlayGlyph className="h-5 w-5 ml-0.5" />
          </NeonControlButton>
        )}
      </div>
    </div>
  );
}

const TILE_ICON_BTN =
  "flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-800 hover:text-slate-200";

function RadioStationTile({ station, onRemove }: { station: RadioStream; onRemove: (id: string) => void }) {
  const { playSource, pause, currentSource, status } = usePlayback();
  const { t } = useTranslations();
  const router = useRouter();
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const active = currentSource?.id === station.id;
  const playing = active && status === "playing";

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/radio/${station.id}`, { method: "DELETE" });
      // 404 = a station that lives only in this browser's local list (or is already gone) — drop it locally too.
      if (res.ok || res.status === 404) {
        onRemove(station.id);
        router.refresh();
      }
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  return (
    <article className="group min-w-0">
      <div
        className={`relative aspect-square overflow-hidden rounded-2xl bg-slate-800 ring-1 transition ${
          active ? "playing-active ring-rose-500/60 shadow-[0_0_20px_rgba(244,63,94,0.2)]" : "ring-slate-800/80 group-hover:ring-slate-600"
        }`}
      >
        <img
          src={station.cover || DEFAULT_IMAGE}
          alt=""
          className={station.cover ? "h-full w-full object-contain p-2" : "h-full w-full object-cover"}
          onError={(e) => (e.currentTarget.src = DEFAULT_IMAGE)}
        />
        {active && (
          <span className="absolute top-2 left-2 rounded bg-red-500 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white shadow-[0_0_6px_rgba(239,68,68,0.8)] animate-pulse">
            {t.live ?? "LIVE"}
          </span>
        )}
        <button
          type="button"
          onClick={() => (playing ? pause() : playSource(radioToUnified(station)))}
          aria-label={playing ? `Pause ${station.name}` : `Play ${station.name}`}
          className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/40 focus-visible:bg-black/40 focus-visible:outline-none"
        >
          <span
            className={`flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-900 shadow-lg transition ${
              playing ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            }`}
          >
            {playing ? <PauseGlyph className="h-5 w-5" /> : <PlayGlyph className="h-5 w-5 ml-0.5" />}
          </span>
        </button>
      </div>
      <div className="mt-2 min-w-0">
        <p className="truncate text-sm font-medium text-slate-100">{station.name}</p>
        {station.genre && <p className="truncate text-xs text-slate-500">{station.genre}</p>}
      </div>
      <div className="mt-1 -ms-1.5 flex items-center gap-0.5">
        <button type="button" onClick={() => setShareOpen(true)} title={t.share} aria-label={t.share} className={TILE_ICON_BTN}>
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" />
          </svg>
        </button>
        <Link href={`/radio/${station.id}/edit`} title={t.edit} aria-label={t.edit} className={TILE_ICON_BTN}>
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </Link>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          disabled={deleting}
          title={t.delete}
          aria-label={t.delete}
          className={`${TILE_ICON_BTN} hover:!bg-rose-950/50 hover:!text-rose-400 disabled:opacity-50`}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
      {shareOpen && (
        <ShareModal
          item={radioToShareable(station)}
          fallbackRadioId={station.id}
          onClose={() => setShareOpen(false)}
        />
      )}
      <DeleteConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} loading={deleting} message={t.deleteSourceConfirm} />
    </article>
  );
}

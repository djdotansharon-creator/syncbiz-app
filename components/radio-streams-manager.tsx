"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { radioToUnified } from "@/lib/radio-utils";
import { RadioStreamCard } from "@/components/radio-stream-card";
import { AddRadioForm } from "@/components/add-radio-form";
import { NeonControlButton } from "@/components/ui/neon-control-button";
import type { RadioStream } from "@/lib/source-types";

type ViewMode = "grid" | "list";

type Props = {
  initialStations: RadioStream[];
};

export function RadioStreamsManager({ initialStations }: Props) {
  const router = useRouter();
  const { t } = useTranslations();
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [genreFilter, setGenreFilter] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [stations, setStations] = useState<RadioStream[]>(initialStations);

  // Sync when parent refetches (e.g. after adding a station)
  useEffect(() => {
    setStations(initialStations);
  }, [initialStations]);

  const genres = useMemo(
    () => [...new Set(stations.map((s) => s.genre).filter(Boolean))].sort(),
    [stations],
  );

  const filtered = useMemo(() => {
    if (!genreFilter) return stations;
    return stations.filter((s) => s.genre?.toLowerCase() === genreFilter.toLowerCase());
  }, [stations, genreFilter]);

  const handleAdd = () => {
    setShowAddForm(false);
    router.refresh();
  };

  const handleRemove = (id: string) => {
    setStations((prev) => prev.filter((s) => s.id !== id));
    router.refresh();
  };

  const handleEdit = (id: string) => {
    router.push(`/radio/${id}/edit`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-xl border border-slate-800 bg-slate-900/60 p-0.5" role="tablist">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                viewMode === "grid" ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              {t.gridView}
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                viewMode === "list" ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
              {t.listView}
            </button>
          </div>
          {genres.length > 0 && (
            <select
              value={genreFilter}
              onChange={(e) => setGenreFilter(e.target.value)}
              className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-sm text-slate-200"
            >
              <option value="">{t.allGenres}</option>
              {genres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            {showAddForm ? t.hide : t.addSource}
          </button>
        </div>
      </div>

      {showAddForm && <AddRadioForm onAdd={handleAdd} />}

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/40 py-16 text-center text-sm text-slate-500">
          {t.radioNoStations}
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((station) => (
            <RadioStreamCard key={station.id} station={station} onRemove={handleRemove} onEdit={handleEdit} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/40 divide-y divide-slate-800/60 overflow-hidden">
          {filtered.map((station) => (
            <RadioStreamRow key={station.id} station={station} onRemove={handleRemove} onEdit={handleEdit} />
          ))}
        </div>
      )}
    </div>
  );
}

function RadioStreamRow({ station, onRemove, onEdit }: { station: RadioStream; onRemove: (id: string) => void; onEdit: (id: string) => void }) {
  const { playSource, stop, pause, currentSource } = usePlayback();
  const unified = radioToUnified(station);
  const active = currentSource?.id === station.id;
  const DEFAULT_IMAGE = "/radio-default.svg";
  const cover = station.cover || DEFAULT_IMAGE;

  return (
    <div
      className={`grid grid-cols-[auto,1fr,auto] gap-4 items-center rounded-xl px-4 py-3 transition-all hover:bg-slate-900/40 ${
        active ? "playing-active bg-slate-900/60" : ""
      }`}
    >
      <div className="relative h-14 w-14 overflow-hidden rounded-lg bg-slate-800">
        <img src={cover} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.src = DEFAULT_IMAGE)} />
      </div>
      <div className="min-w-0 flex-1 flex items-center gap-3">
        <span className="truncate font-medium text-slate-100">{station.name}</span>
        {station.genre && <span className="text-xs text-slate-500">{station.genre}</span>}
      </div>
      <div className="flex flex-nowrap items-center gap-2" role="group" aria-label="Radio controls">
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
        <NeonControlButton size="sm" onClick={() => onEdit(station.id)} title="Edit" aria-label="Edit">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </NeonControlButton>
      </div>
    </div>
  );
}

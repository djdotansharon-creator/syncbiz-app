"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { radioToUnified } from "@/lib/radio-utils";
import { RadioIcon } from "@/components/ui/radio-icon";
import { addRadioStationLocal } from "@/lib/radio-local-store";
import type { RadioStream } from "@/lib/source-types";

type RadioResult = { title: string; url: string; cover: string | null; genre: string };

async function searchRadio(q: string): Promise<RadioResult[]> {
  if (!q.trim() || q.length < 2) return [];
  const res = await fetch(`/api/sources/search?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  return data.radioResults || [];
}

type Props = {
  onAdd: () => void;
};

export function RadioSearchBar({ onAdd }: Props) {
  const router = useRouter();
  const { t } = useTranslations();
  const { playSource } = usePlayback();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RadioResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const radio = await searchRadio(q);
      setResults(radio);
      setShowResults(true);
    } finally {
      setSearching(false);
    }
  }, [query]);

  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setResults([]);
      setShowResults(false);
      return;
    }
    const id = setTimeout(runSearch, 200);
    return () => clearTimeout(id);
  }, [query, runSearch]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleAdd = useCallback(
    async (r: RadioResult) => {
      const res = await fetch("/api/radio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: r.title,
          url: r.url,
          genre: r.genre || "Radio",
          cover: r.cover,
        }),
      });
      if (res.ok) {
        const station = (await res.json()) as RadioStream;
        addRadioStationLocal(station);
        router.refresh();
        onAdd();
        setQuery("");
        setResults([]);
        setShowResults(false);
      }
    },
    [router, onAdd]
  );

  const handlePlay = useCallback(
    async (r: RadioResult) => {
      const res = await fetch("/api/radio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: r.title,
          url: r.url,
          genre: r.genre || "Radio",
          cover: r.cover,
        }),
      });
      if (res.ok) {
        const station = (await res.json()) as RadioStream;
        addRadioStationLocal(station);
        playSource(radioToUnified(station));
        router.refresh();
        onAdd();
        setQuery("");
        setResults([]);
        setShowResults(false);
      }
    },
    [playSource, router, onAdd]
  );

  const hasResults = results.length > 0;
  const hasQuery = query.trim().length >= 2;

  return (
    <div ref={panelRef} className="relative">
      <div
        className={`relative flex items-center gap-2 rounded-xl border border-slate-800/80 bg-slate-800/80 ring-1 ring-slate-700/60 backdrop-blur-sm transition-all focus-within:border-sky-500/50 focus-within:ring-2 focus-within:ring-sky-500/20 ${
          showResults && hasResults ? "rounded-b-none border-b-0" : ""
        }`}
      >
        <span className="pl-3 text-slate-500">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowResults(true);
          }}
          onFocus={() => hasQuery && setShowResults(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hasResults && results.length > 0) {
              e.preventDefault();
              void handlePlay(results[0]);
            }
          }}
          placeholder={t.searchRadioPlaceholder ?? "Search radio stations…"}
          className="h-10 flex-1 bg-transparent py-2 pr-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          aria-label={t.search}
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setResults([]);
              setShowResults(false);
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-700/60 hover:text-slate-200"
            aria-label="Clear"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {showResults && hasQuery && (
        <div className="absolute left-0 right-0 top-full z-50 max-h-72 overflow-y-auto rounded-b-xl border border-t-0 border-slate-800/80 bg-slate-950/98 shadow-xl">
          {searching ? (
            <div className="py-6 text-center text-sm text-slate-500">{t.searching ?? "Searching…"}</div>
          ) : hasResults ? (
            <div className="p-2">
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {t.radioResults ?? "Radio stations"}
              </p>
              <div className="space-y-0.5">
                {results.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-slate-800/80">
                    <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-slate-800">
                      {r.cover ? (
                        <img src={r.cover} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-rose-400">
                          <RadioIcon className="h-5 w-5" />
                        </div>
                      )}
                      <span className="absolute bottom-0 right-0 rounded bg-rose-500/90 px-1 py-0.5 text-[9px] font-medium text-white">
                        {t.live ?? "LIVE"}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-100">{r.title}</p>
                      <p className="text-[10px] text-slate-500">{r.genre && r.genre !== "Radio" ? r.genre : "Radio"}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void handleAdd(r)}
                        className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-600 bg-slate-800/90 px-2.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
                      >
                        {t.addToRadio ?? "Add to Radio"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handlePlay(r)}
                        className="inline-flex h-8 items-center justify-center rounded-lg bg-[#1db954] px-2.5 text-xs font-semibold text-white transition hover:bg-[#1ed760]"
                      >
                        {t.playNow}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-slate-500">{t.noSearchResults}</div>
          )}
        </div>
      )}
    </div>
  );
}

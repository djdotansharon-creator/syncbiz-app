"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "@/lib/locale-context";
import { isValidStreamUrl } from "@/lib/url-validation";
import { NeonControlButton } from "@/components/ui/neon-control-button";
import { addRadioStationLocal } from "@/lib/radio-local-store";
import type { RadioStream } from "@/lib/source-types";

const DEFAULT_IMAGE = "/radio-default.svg";

type Props = {
  onAdd: () => void;
};

export function AddRadioForm({ onAdd }: Props) {
  const { t } = useTranslations();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [genre, setGenre] = useState("Radio");
  const [cover, setCover] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchingMeta, setFetchingMeta] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const fetchMetadata = useCallback(async (inputUrl: string) => {
    setFetchingMeta(true);
    try {
      const res = await fetch("/api/radio/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: inputUrl }),
      });
      const data = await res.json();
      if (data.title) setName(data.title);
      if (data.genre) setGenre(data.genre);
      if (data.image) setCover(data.image);
    } catch {
      setName("");
      setGenre("Radio");
      setCover(null);
    } finally {
      setFetchingMeta(false);
    }
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const u = url.trim();
      const n = name.trim();
      if (!u || !n) return;
      if (!isValidStreamUrl(u)) return;
      setLoading(true);
      try {
        const res = await fetch("/api/radio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: u,
            name: n,
            genre: genre.trim() || "Radio",
            cover: cover || null,
          }),
        });
        if (res.ok) {
          const station = (await res.json()) as RadioStream;
          addRadioStationLocal(station);
          setUrl("");
          setName("");
          setGenre("Radio");
          setCover(null);
          onAdd();
        }
      } finally {
        setLoading(false);
      }
    },
    [url, name, genre, cover, onAdd],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const text = e.dataTransfer.getData("text/plain")?.trim();
      if (text && (text.startsWith("http://") || text.startsWith("https://"))) {
        setUrl(text);
        fetchMetadata(text);
      }
    },
    [fetchMetadata],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const text = e.clipboardData.getData("text/plain")?.trim();
      if (text && (text.startsWith("http://") || text.startsWith("https://"))) {
        setUrl(text);
        fetchMetadata(text);
      }
    },
    [fetchMetadata],
  );

  const handleFetchMeta = useCallback(() => {
    const u = url.trim();
    if (u) fetchMetadata(u);
  }, [url, fetchMetadata]);

  return (
    <form
      onSubmit={handleSubmit}
      onDrop={handleDrop}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onPaste={handlePaste}
      className={`rounded-2xl border-2 border-dashed p-6 transition-all ${
        dragOver ? "border-rose-500/60 bg-rose-500/10" : "border-slate-700/80 bg-slate-900/40"
      }`}
    >
      <div className="mb-4 text-center">
        <p className="text-sm font-medium text-slate-300">{t.radioDropUrl}</p>
        <p className="mt-1 text-xs text-slate-500">{t.radioDropHint}</p>
      </div>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">{t.targetUrl}</label>
          <div className="flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/stream"
              className="flex-1 rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-rose-500/50 focus:outline-none focus:ring-1 focus:ring-rose-500/30"
            />
            <NeonControlButton
              size="sm"
              onClick={handleFetchMeta}
              disabled={!url.trim() || fetchingMeta}
              title={t.radioFetchMeta}
            >
              {fetchingMeta ? "…" : t.radioFetchMeta}
            </NeonControlButton>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">{t.name}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Station name"
            className="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-rose-500/50 focus:outline-none focus:ring-1 focus:ring-rose-500/30"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">{t.radioGenre}</label>
          <input
            type="text"
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            placeholder="Radio"
            className="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-rose-500/50 focus:outline-none focus:ring-1 focus:ring-rose-500/30"
          />
        </div>
        {cover && (
          <div className="flex items-center gap-3">
            <img src={cover} alt="" className="h-12 w-12 rounded-lg object-cover" onError={(e) => (e.currentTarget.src = DEFAULT_IMAGE)} />
            <button type="button" onClick={() => setCover(null)} className="text-xs text-slate-500 hover:text-slate-300">
              {t.radioRemoveCover}
            </button>
          </div>
        )}
        {url.trim() && !isValidStreamUrl(url.trim()) && (
          <p className="flex items-center gap-2 text-sm text-amber-400">
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            {t.radioInvalidUrl}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <NeonControlButton type="submit" disabled={!url.trim() || !name.trim() || !isValidStreamUrl(url.trim()) || loading}>
            {loading ? t.saving : t.radioAddStation}
          </NeonControlButton>
        </div>
      </div>
    </form>
  );
}

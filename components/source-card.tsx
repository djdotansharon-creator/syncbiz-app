"use client";

import { useState } from "react";
import { PlayNowButton } from "@/components/playback-controls";
import { useTranslations } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-context";
import type { Source } from "@/lib/types";

function PlaceholderArtwork() {
  return (
    <div
      className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 text-slate-500"
      aria-hidden
    >
      <svg
        className="h-10 w-10 opacity-60"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    </div>
  );
}

function SourceArtwork({ source }: { source: Source }) {
  const [errored, setErrored] = useState(false);
  if (source.artworkUrl && !errored) {
    return (
      <div className="relative h-full w-full bg-slate-800">
        <img
          src={source.artworkUrl}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setErrored(true)}
        />
      </div>
    );
  }
  return <PlaceholderArtwork />;
}

type SourceCardProps = {
  source: Source;
};

export function SourceCard({ source }: SourceCardProps) {
  const { t } = useTranslations();
  const { playSource, setLastMessage } = usePlayback();
  const [playing, setPlaying] = useState(false);

  async function handlePlayNow() {
    setPlaying(true);
    setLastMessage(null);
    try {
      playSource(source);
      const target = (source.target ?? source.uriOrPath ?? "").trim();
      if (!target) {
        setLastMessage("Failed: No target path");
        return;
      }
      const res = await fetch("/api/commands/play-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          browserPreference: source.browserPreference ?? "default",
        }),
      });
      if (res.ok) {
        setLastMessage("Local playback command sent");
      } else {
        const data = await res.json().catch(() => ({}));
        setLastMessage(data?.error ? `Failed: ${data.error}` : "Playback failed.");
      }
    } finally {
      setPlaying(false);
    }
  }

  const typeLabel = t[`sourceType_${source.type}`] ?? source.type.replace(/_/g, " ");
  const url = source.target ?? source.uriOrPath ?? "";

  return (
    <article
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/60 transition-all duration-200 hover:border-slate-700/80 hover:bg-slate-900/40"
      data-source-id={source.id}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-slate-900">
        <SourceArtwork source={source} />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="truncate text-base font-semibold text-slate-100">
          {source.name}
        </h3>
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
          {typeLabel}
        </p>
        {url && (
          <p className="min-h-0 flex-1 truncate text-xs text-slate-500">
            {url}
          </p>
        )}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
              source.isLive
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-slate-800 text-slate-500"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                source.isLive ? "bg-emerald-400" : "bg-slate-500"
              }`}
            />
            {source.isLive ? t.available : t.configured}
          </span>
          <PlayNowButton
            onClick={handlePlayNow}
            loading={playing}
            label={t.play}
            loadingLabel={t.sending}
          />
        </div>
      </div>
    </article>
  );
}

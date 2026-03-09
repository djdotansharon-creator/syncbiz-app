"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PlayNowButton } from "@/components/playback-controls";
import { usePlayback } from "@/lib/playback-context";
import type { Source } from "@/lib/types";

type SourceRowProps = {
  source: Source;
};

export function SourceRow({ source }: SourceRowProps) {
  const router = useRouter();
  const { playSource, setLastMessage } = usePlayback();
  const [playing, setPlaying] = useState(false);

  async function handlePlayNow() {
    setPlaying(true);
    setLastMessage(null);
    try {
      playSource(source);
      if (source.type === "local_playlist") {
        const target = (source.target ?? source.uriOrPath ?? "").trim();
        if (target) {
          const res = await fetch("/api/commands/play-local", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target }),
          });
          setLastMessage(res.ok ? "Local playback command sent" : `Failed: ${(await res.json().catch(() => ({}))).error ?? "Unknown error"}`);
        }
      } else {
        await fetch("/api/play-now", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceId: source.id }),
        });
      }
      router.refresh();
    } finally {
      setPlaying(false);
    }
  }

  return (
    <div className="grid grid-cols-[1.5fr,1fr,2fr,0.7fr,auto] gap-4 px-4 py-3 text-sm transition hover:bg-slate-900/40 items-center">
      <div>
        <p className="font-medium text-slate-100">{source.name}</p>
        {source.description && (
          <p className="text-xs text-slate-500">{source.description}</p>
        )}
      </div>
      <div>
        <p className="text-slate-200">{source.type.replace(/_/g, " ")}</p>
      </div>
      <div className="min-w-0">
        <p className="truncate text-slate-200">
          {source.target ?? source.uriOrPath}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${
            source.isLive ? "bg-emerald-400" : "bg-slate-500"
          }`}
        />
        <span className="text-slate-200">
          {source.isLive ? "Available" : "Configured"}
        </span>
      </div>
      <PlayNowButton
        onClick={handlePlayNow}
        loading={playing}
        label="Play now"
        loadingLabel="Sending…"
      />
    </div>
  );
}

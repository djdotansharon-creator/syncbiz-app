"use client";

import { useEffect, useState } from "react";

/**
 * Customer-facing "Download VONO Streamer" control for the Downloads page.
 * Fetches /api/streamer/apk and renders either a real download button (same-origin
 * /api/streamer/apk/download) or an honest "release build in progress" state.
 * No developer terminology. (Copy is intentionally plain English for now — this
 * page is not yet wired into the i18n string tables.)
 */

type ApkInfo = {
  ok?: boolean;
  url?: string | null;
  fileName?: string | null;
  version?: string | null;
  sizeBytes?: number | null;
  releasesPageUrl?: string;
};

function formatMB(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes)) return null;
  return `${(bytes / 1_000_000).toFixed(0)} MB`;
}

function DownloadGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export function StreamerDownloadButton() {
  const [info, setInfo] = useState<ApkInfo | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch("/api/streamer/apk", { cache: "no-store" });
        const data = (await resp.json().catch(() => ({}))) as ApkInfo;
        if (!cancelled) setInfo(data);
      } catch {
        if (!cancelled) setInfo({ ok: false });
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) {
    return <div className="h-11 w-full animate-pulse rounded-xl bg-slate-800/50" aria-hidden />;
  }

  const releases =
    info?.releasesPageUrl && info.releasesPageUrl.startsWith("https://")
      ? info.releasesPageUrl
      : "https://github.com/djdotansharon-creator/syncbiz-app/releases";

  if (info?.ok && info.url) {
    const sizeLabel = formatMB(info.sizeBytes);
    return (
      <div className="flex flex-col gap-2">
        <a
          href={info.url}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-sky-600 via-blue-800 to-slate-950 px-4 py-3 text-center text-sm font-bold text-white shadow-[0_10px_32px_rgba(12,74,120,0.45)] ring-1 ring-sky-400/30 transition hover:from-sky-500 hover:via-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        >
          <DownloadGlyph className="h-5 w-5 shrink-0" />
          Download VONO Streamer
          {info.version ? <span className="ml-1 tabular-nums opacity-90">(v{info.version})</span> : null}
        </a>
        <p className="text-center text-xs text-slate-500">
          After download, open the file and allow installation from this source if Android asks.
          {sizeLabel ? ` (${sizeLabel})` : null}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700/70 bg-slate-900/60 px-4 py-3 text-center text-sm font-semibold text-slate-300">
        <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden />
        Release build in progress
      </div>
      <p className="text-center text-xs text-slate-500">
        The installable app is being prepared.{" "}
        <a
          href={releases}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-300 underline decoration-sky-500/50 underline-offset-2 hover:text-sky-200"
        >
          Check available builds
        </a>
      </p>
    </div>
  );
}

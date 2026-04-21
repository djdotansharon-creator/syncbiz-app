"use client";

import { useEffect, useState } from "react";

/**
 * Browser-only affordance to download the SyncBiz Desktop installer.
 *
 * - Hidden inside Electron (`window.syncbizDesktop`) because the user is
 *   already running it.
 * - Hidden until `/api/desktop/download` returns a real asset URL, so the
 *   button doesn't point to a 404 before the first release is published.
 * - Uses the UA-based platform guess from the server; user can re-pick the
 *   other macOS arch via the title tooltip → full release page.
 */

type DownloadInfo = {
  ok: true;
  platform: string;
  version: string;
  releasedAt: string | null;
  url: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  downloads: Array<{ name: string; url: string; sizeBytes: number }>;
};

function formatMB(bytes: number | null): string | null {
  if (!bytes || !Number.isFinite(bytes)) return null;
  return `${(bytes / 1_000_000).toFixed(0)} MB`;
}

function isRunningInElectron(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as Window & { syncbizDesktop?: unknown }).syncbizDesktop);
}

export function DesktopDownloadButton() {
  const [info, setInfo] = useState<DownloadInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  /**
   * Don't render anything during SSR or inside Electron. We still initialize
   * `inElectron` after mount because SSR doesn't see `window` and we don't
   * want a hydration mismatch.
   */
  const [inElectron, setInElectron] = useState(false);

  useEffect(() => {
    setInElectron(isRunningInElectron());
  }, []);

  useEffect(() => {
    if (inElectron) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch("/api/desktop/download", { cache: "no-store" });
        if (!resp.ok) {
          setLoaded(true);
          return;
        }
        const data = (await resp.json()) as DownloadInfo | { ok: false };
        if (cancelled) return;
        if ("ok" in data && data.ok && data.url) {
          setInfo(data);
        }
      } catch {
        // Network or GitHub rate-limit: stay hidden; not a critical feature.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inElectron]);

  if (inElectron || !loaded || !info?.url) return null;

  const sizeLabel = formatMB(info.sizeBytes);
  const title = `Download SyncBiz Player ${info.version}${sizeLabel ? ` (${sizeLabel})` : ""}`;

  return (
    <a
      href={info.url}
      download={info.fileName ?? undefined}
      title={title}
      aria-label={title}
      className="hidden items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-200 transition hover:border-sky-400 hover:bg-sky-500/20 hover:text-sky-100 sm:inline-flex"
    >
      <svg
        className="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      <span>Desktop</span>
      <span className="rounded-full bg-sky-400/20 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-sky-100">
        v{info.version}
      </span>
    </a>
  );
}

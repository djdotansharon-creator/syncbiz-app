"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "@/lib/locale-context";

/**
 * Electron-only header pill. Compares the running desktop app version
 * (`window.syncbizDesktop.getAppVersion()`) against the canonical version
 * advertised by `/api/desktop/download`. When the API version is newer it
 * surfaces an "Update available vX.Y.Z" link to the installer (`data.url`)
 * or, if no direct installer URL is resolvable, the GitHub releases page.
 *
 * Backward compatibility: desktop builds <= 0.1.2 shipped before the
 * `getAppVersion` bridge existed. Those clients still expose
 * `window.syncbizDesktop` (so we can tell it's the desktop app) but cannot
 * report their own version. We must NOT hide the pill from them — they are by
 * definition the oldest installs and the ones that most need to update. For
 * those clients we skip the version comparison and notify whenever the server
 * advertises a build newer than the last bridge-less release.
 *
 * Renders nothing in the browser (the browser gets `DesktopDownloadButton`),
 * while a build is current, or if the endpoint can't be read.
 */

const DEFAULT_RELEASES = "https://github.com/djdotansharon-creator/syncbiz-app/releases";

/**
 * Last desktop version shipped WITHOUT the `getAppVersion` bridge. Any client
 * missing the bridge is <= this version, so a server build newer than this is
 * unambiguously an update for them (and this avoids a false "update available"
 * when the server hasn't been bumped past 0.1.2 yet).
 */
const LAST_LEGACY_VERSION = "0.1.2";

type DesktopBridge = { getAppVersion?: () => Promise<string> };

function desktopBridge(): DesktopBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { syncbizDesktop?: DesktopBridge }).syncbizDesktop;
}

/** [major, minor, patch] from "X.Y.Z(-tag)"; non-numeric segments → 0. */
function parseSemver(v: string): [number, number, number] | null {
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** True when `latest` is strictly newer than `current`. */
function isNewer(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

const PILL_CLASS =
  "group inline-flex max-w-[10rem] items-center gap-1.5 rounded-full border border-amber-500/50 " +
  "bg-gradient-to-b from-amber-900/40 via-slate-900 to-slate-950 px-2.5 py-1.5 " +
  "text-[11px] font-semibold text-amber-100 shadow-sm ring-1 ring-amber-900/30 " +
  "transition hover:from-amber-800/50 hover:text-white hover:ring-amber-600/50 " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 " +
  "active:scale-[0.99] sm:max-w-none sm:px-3 sm:text-xs";

export function DesktopUpdatePill() {
  const { t } = useTranslations();
  const tr = t as unknown as Record<string, string | undefined>;
  const [target, setTarget] = useState<{ version: string; href: string } | null>(null);

  useEffect(() => {
    const bridge = desktopBridge();
    // Presence of the bridge object = running in the desktop app. This is true
    // for ALL desktop versions, including legacy <= 0.1.2 that lack getAppVersion.
    if (!bridge) return;
    let cancelled = false;

    (async () => {
      try {
        // Legacy desktop (<= 0.1.2) has no getAppVersion — current stays null.
        const current =
          typeof bridge.getAppVersion === "function"
            ? (await bridge.getAppVersion()).trim()
            : null;

        const resp = await fetch("/api/desktop/download", { cache: "no-store" });
        const data = (await resp.json().catch(() => ({}))) as {
          version?: string;
          expectedVersion?: string;
          url?: string | null;
          releasesPageUrl?: string;
        };
        if (cancelled) return;

        // `version` on ok:true; `expectedVersion` on ok:false (no installer yet) —
        // both are the canonical advertised desktop version.
        const latest = (data.version ?? data.expectedVersion ?? "").trim();
        if (!latest) return;

        const shouldNotify =
          current === null
            ? // Legacy client: it predates the bridge, so any server build newer
              // than the last bridge-less release is an update for it.
              isNewer(latest, LAST_LEGACY_VERSION)
            : isNewer(latest, current);
        if (!shouldNotify) return;

        const directUrl = typeof data.url === "string" ? data.url.trim() : "";
        const releases =
          typeof data.releasesPageUrl === "string" && data.releasesPageUrl.startsWith("https://")
            ? data.releasesPageUrl
            : DEFAULT_RELEASES;
        setTarget({ version: latest, href: directUrl.length > 0 ? directUrl : releases });
      } catch {
        /* offline / endpoint unreachable / version unreadable — stay silent */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!target) return null;

  const label = (tr.desktopUpdateAvailable ?? "Update available v{v}").replaceAll("{v}", target.version);

  return (
    <a
      href={target.href}
      target="_blank"
      rel="noopener noreferrer"
      className={PILL_CLASS}
      title={label}
    >
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-900/70 ring-1 ring-amber-500/30"
        aria-hidden
      >
        <svg
          className="h-3.5 w-3.5 text-amber-200"
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
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </a>
  );
}

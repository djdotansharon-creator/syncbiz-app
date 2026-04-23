"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "@/lib/locale-context";

/**
 * Small header trigger (browser only) + center modal with hero image and install actions.
 * Does not navigate away on click; GitHub is secondary when no build exists.
 */

const HERO_PNG = "/desktop-download-hero.png";
const HERO_SVG = "/desktop-promo-illustration.svg";

export type DownloadInfo = {
  ok?: boolean;
  platform?: string;
  version?: string;
  releasedAt?: string | null;
  url: string | null;
  fileName?: string | null;
  sizeBytes?: number | null;
  releasesPageUrl?: string;
  downloads?: Array<{ name: string; url: string; sizeBytes: number }>;
  error?: string;
  source?: "github" | "env" | "bundle" | "default";
};

type ButtonView =
  | { kind: "direct"; href: string; download: string | undefined; version: string; title: string }
  | { kind: "fallback"; href: string; version?: string; title: string; external: true };

type Payload = { view: ButtonView; data: DownloadInfo };

function formatMB(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes)) return null;
  return `${(bytes / 1_000_000).toFixed(0)} MB`;
}

function isRunningInElectron(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as Window & { syncbizDesktop?: unknown }).syncbizDesktop);
}

function subWithVersion(tpl: string, v: string): string {
  return tpl.replaceAll("{v}", v);
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

function buildPayload(data: DownloadInfo, tr: Record<string, string | undefined>): Payload {
  const releases =
    typeof data.releasesPageUrl === "string" && data.releasesPageUrl.startsWith("https://")
      ? data.releasesPageUrl
      : "https://github.com/djdotansharon-creator/syncbiz-app/releases";
  if (data.ok && data.url) {
    const v = (data.version ?? "?").trim() || "?";
    const sizeLabel = formatMB(data.sizeBytes);
    const title = `${tr.downloadDesktopAppTitle ?? "Download"} ${v}${sizeLabel ? ` (${sizeLabel})` : ""}`;
    return { data, view: { kind: "direct" as const, href: data.url, download: data.fileName ?? undefined, version: v, title } };
  }
  if (data.url) {
    const v = (data.version ?? "?").trim() || "?";
    return { data, view: { kind: "direct" as const, href: data.url, download: data.fileName ?? undefined, version: v, title: `${tr.downloadDesktopAppTitle ?? "Download"} ${v}` } };
  }
  return {
    data,
    view: {
      kind: "fallback" as const,
      href: releases,
      version: data.ok && data.version ? data.version : undefined,
      title: tr.downloadDesktopFromGitHub ?? "GitHub",
      external: true,
    },
  };
}

type DesktopDownloadModalProps = {
  onClose: () => void;
  payload: Payload;
};

function DesktopDownloadModal({ onClose, payload }: DesktopDownloadModalProps) {
  const { t, locale } = useTranslations();
  const id = useId();
  const titleId = `${id}-title`;
  const [mounted, setMounted] = useState(false);
  const [useCustomHeroPng, setUseCustomHeroPng] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(HERO_PNG, { method: "HEAD", cache: "no-store" })
      .then((r) => {
        if (!cancelled && r.ok) setUseCustomHeroPng(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!mounted) return null;

  const { view, data } = payload;
  const hasDirect = view.kind === "direct";
  const releasesPage =
    typeof data.releasesPageUrl === "string" && data.releasesPageUrl.startsWith("https://")
      ? data.releasesPageUrl
      : "https://github.com/djdotansharon-creator/syncbiz-app/releases";
  const extraFiles = (data.downloads ?? []).filter((d) => d.name && d.url);
  const dir = locale === "he" ? "rtl" : "ltr";

  const panel = (
    <div
      className="fixed inset-0 z-[530] flex items-center justify-center p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm"
        aria-label={t.downloadDesktopClose}
        onClick={onClose}
      />
      <div
        className="relative z-[531] w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-600/50 bg-slate-950 shadow-[0_32px_64px_rgba(0,0,0,0.65)] ring-1 ring-sky-900/30"
        dir={dir}
      >
        <div className="grid gap-0 sm:grid-cols-2 sm:items-stretch">
          <div className="relative aspect-[16/9] w-full min-h-[11rem] bg-slate-900 sm:min-h-0 sm:aspect-auto">
            {useCustomHeroPng ? (
              <img src={HERO_PNG} alt="" className="h-full w-full object-cover" />
            ) : (
              <img src={HERO_SVG} alt="" className="h-full w-full object-cover" />
            )}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-transparent sm:bg-gradient-to-r" />
          </div>
          <div className="flex flex-col justify-center gap-4 p-5 sm:p-7">
            <div>
              <h2 id={titleId} className="text-lg font-bold tracking-tight text-slate-50 sm:text-xl">
                {t.downloadDesktopModalTitle}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{t.downloadDesktopModalBody}</p>
            </div>
            {hasDirect ? (
              <div className="flex flex-col gap-3">
                <a
                  href={view.href}
                  download={view.download}
                  onClick={onClose}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-sky-600 via-blue-800 to-slate-950 px-4 py-3 text-center text-sm font-bold text-white shadow-[0_10px_32px_rgba(12,74,120,0.45)] ring-1 ring-sky-400/30 transition hover:from-sky-500 hover:via-blue-700 hover:shadow-sky-900/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                >
                  <DownloadGlyph className="h-5 w-5 shrink-0" />
                  {t.downloadDesktopModalDownload}
                  {view.version ? <span className="ml-1 tabular-nums opacity-90">(v{view.version})</span> : null}
                </a>
                <p className="text-center text-xs text-slate-500">
                  {formatMB(data.sizeBytes) ? `${formatMB(data.sizeBytes)} — ` : null}
                  {t.downloadDesktopCtaSub}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {extraFiles.length > 0 ? (
                  <ul className="max-h-40 space-y-2 overflow-y-auto text-sm text-slate-300">
                    {extraFiles.map((a) => (
                      <li key={a.name}>
                        <a href={a.url} className="text-sky-300 underline decoration-sky-500/50 underline-offset-2 hover:text-sky-200" rel="noreferrer" target="_blank">
                          {a.name}
                        </a>
                        {formatMB(a.sizeBytes) ? <span className="ms-1 text-slate-500">({formatMB(a.sizeBytes)})</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-amber-200/90">{t.downloadDesktopModalNoBuild}</p>
                )}
                {view.version ? (
                  <p className="text-xs text-slate-500">{subWithVersion(t.downloadDesktopCtaSubWithVersion, view.version)}</p>
                ) : null}
                <a
                  href={releasesPage}
                  rel="noopener noreferrer"
                  target="_blank"
                  className="text-center text-sm font-medium text-sky-300 underline decoration-sky-500/50 underline-offset-2 hover:text-sky-200"
                >
                  {t.downloadDesktopModalGitHubLink}
                </a>
              </div>
            )}
            <div className="mt-1 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-600/80 bg-slate-800/60 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-700"
              >
                {t.downloadDesktopClose}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}

const HEADER_BTN =
  "group inline-flex max-w-[8.5rem] items-center gap-1.5 rounded-full border border-sky-500/40 " +
  "bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950 px-2.5 py-1.5 " +
  "text-[11px] font-semibold text-sky-100 shadow-sm ring-1 ring-sky-900/30 " +
  "transition hover:from-slate-800 hover:via-sky-950/80 hover:text-white hover:ring-sky-600/50 " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 " +
  "active:scale-[0.99] sm:max-w-none sm:px-3 sm:text-xs";

export function DesktopDownloadButton() {
  const { t, locale } = useTranslations();
  const tr = t as unknown as Record<string, string | undefined>;
  const [payload, setPayload] = useState<Payload | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [inElectron, setInElectron] = useState(false);

  useEffect(() => {
    setInElectron(isRunningInElectron());
  }, []);

  useEffect(() => {
    if (inElectron) return;
    let cancelled = false;
    setLoaded(false);
    (async () => {
      try {
        const resp = await fetch("/api/desktop/download", { cache: "no-store" });
        const data = (await resp.json().catch(() => ({}))) as DownloadInfo;
        if (cancelled) return;
        setPayload(buildPayload(data, tr));
      } catch {
        if (cancelled) return;
        setPayload(
          buildPayload(
            { url: null, releasesPageUrl: "https://github.com/djdotansharon-creator/syncbiz-app/releases" },
            tr,
          ),
        );
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inElectron, locale, t]);

  if (inElectron || !loaded || !payload) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className={HEADER_BTN}
        title={t.downloadDesktopAppTitle}
        aria-haspopup="dialog"
        aria-expanded={modalOpen}
      >
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-900/80 ring-1 ring-sky-500/30"
          aria-hidden
        >
          <DownloadGlyph className="h-3.5 w-3.5 text-sky-200" />
        </span>
        <span className="min-w-0 truncate">{t.downloadDesktopApp}</span>
      </button>
      {modalOpen && <DesktopDownloadModal onClose={() => setModalOpen(false)} payload={payload} />}
    </>
  );
}

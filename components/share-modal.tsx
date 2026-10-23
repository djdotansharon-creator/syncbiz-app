"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "@/lib/locale-context";
import {
  getShareableSourceUrl,
  shareMedia,
  type ShareableItem,
  type SharePlatform,
} from "@/lib/share-utils";

type Props = {
  item: ShareableItem;
  fallbackPlaylistId?: string;
  fallbackRadioId?: string;
  /** Web URL for social sharers when resolved URL is syncbiz:// */
  shareUrlWeb?: string;
  onClose: () => void;
};

const shareBtnBase =
  "inline-flex items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-900/80 px-3 py-2 text-sm font-medium text-slate-300 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_2px_6px_rgba(0,0,0,0.2)] transition-all duration-150 hover:border-slate-600 hover:bg-slate-800/90 hover:text-slate-100 hover:shadow-[0_0_12px_rgba(100,116,139,0.08)] focus:outline-none focus:ring-2 focus:ring-slate-400/30 focus:ring-offset-2 focus:ring-offset-slate-950";

function IconWhatsApp() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function IconTelegram() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

function IconFacebook() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function IconEmail() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 6-10 7L2 6" />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16V4a2 2 0 0 1 2-2h12" />
    </svg>
  );
}

const shareOptions: { platform: SharePlatform; label: string; icon: React.ReactNode }[] = [
  { platform: "whatsapp", label: "WhatsApp", icon: <IconWhatsApp /> },
  { platform: "telegram", label: "Telegram", icon: <IconTelegram /> },
  { platform: "facebook", label: "Facebook", icon: <IconFacebook /> },
  { platform: "mail", label: "Mail", icon: <IconEmail /> },
];

export function ShareModal({
  item,
  fallbackPlaylistId,
  fallbackRadioId,
  shareUrlWeb,
  onClose,
}: Props) {
  const { t } = useTranslations();
  const [copyToast, setCopyToast] = useState(false);

  const { url: shareUrl, isFallback } = useMemo(
    () => getShareableSourceUrl(item, fallbackPlaylistId, fallbackRadioId),
    [item, fallbackPlaylistId, fallbackRadioId]
  );

  const handleShare = (platform: SharePlatform) => {
    shareMedia(platform, {
      item,
      fallbackPlaylistId,
      fallbackRadioId,
      shareUrlWeb,
      onCopySuccess: () => {
        setCopyToast(true);
        setTimeout(() => setCopyToast(false), 2000);
      },
      onError: (msg) => {
        // Could show error toast; for now rely on shareMedia internal behavior
        console.warn("[ShareModal]", msg);
      },
    });
    if (platform !== "copy" && platform !== "mail") onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share media"
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-slate-700/80 bg-slate-900/98 p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03),0_4px_24px_rgba(0,0,0,0.4),0_0_1px_rgba(0,0,0,0.5)] ring-1 ring-slate-800/60"
        onClick={(e) => e.stopPropagation()}
      >
        {copyToast && (
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-lg bg-emerald-500/95 px-4 py-2 text-sm font-medium text-white shadow-lg">
            {t.linkCopiedToClipboard ?? "Link copied to clipboard"}
          </div>
        )}
        <h2 className="text-lg font-semibold text-slate-100">Share</h2>
        <p className="mt-1 truncate text-sm text-slate-400">{item.title}</p>

        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-slate-500">
            {t.originalSourceUrl ?? "Original source URL"}
          </label>
          <input
            type="text"
            readOnly
            value={shareUrl}
            className="w-full rounded-lg border border-slate-600/80 bg-slate-800/60 px-3 py-2 text-sm text-slate-200 outline-none"
          />
          {isFallback && (
            <p className="mt-1.5 text-xs text-amber-400/90">
              {t.originalSourceNotFoundFallback ?? "Original source not found — using internal fallback link"}
            </p>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {shareOptions.map((opt) => (
            <button
              key={opt.platform}
              type="button"
              onClick={() => handleShare(opt.platform)}
              className={shareBtnBase}
            >
              {opt.icon}
              <span className="font-medium">{opt.label}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => handleShare("copy")}
            className={shareBtnBase}
          >
            <IconCopy />
            <span className="font-medium">{t.copyLink ?? "Copy Link"}</span>
          </button>
        </div>

        <button
          onClick={onClose}
          className="mt-5 w-full rounded-2xl border-2 border-slate-600/80 bg-slate-800/90 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-700/90 hover:text-slate-100"
        >
          {t.close ?? "Close"}
        </button>
      </div>
    </div>
  );
}

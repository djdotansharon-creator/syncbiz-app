"use client";

import { useEffect } from "react";
import type { GuestRecommendationPayload } from "@/lib/remote-control/types";

type Props = {
  recommendation: GuestRecommendationPayload | null;
  onClose: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  loading?: boolean;
};

export function GuestRecommendationModal({
  recommendation,
  onClose,
  onApprove,
  onReject,
  loading = false,
}: Props) {
  useEffect(() => {
    if (!recommendation) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [recommendation, onClose]);

  if (!recommendation) return null;

  const from = recommendation.guestName || "A guest";
  const url = recommendation.sourceUrl;
  const shortUrl = url.length > 50 ? url.slice(0, 47) + "…" : url;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guest-rec-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-700/80 bg-gradient-to-b from-slate-900 to-slate-950 p-6 shadow-[0_24px_48px_rgba(0,0,0,0.5)] ring-1 ring-slate-800/80"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 text-amber-400">
          <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <h2 id="guest-rec-title" className="text-lg font-semibold text-slate-100">
            Guest recommendation
          </h2>
        </div>
        <p className="mt-3 text-sm text-slate-400">
          <span className="font-medium text-slate-300">{from}</span> recommends:
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 block truncate text-sm text-amber-400 hover:text-amber-300 underline"
        >
          {shortUrl}
        </a>
        {recommendation.guestMessage && (
          <p className="mt-2 text-sm text-slate-500 italic">"{recommendation.guestMessage}"</p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              onReject?.(recommendation.id);
              onClose();
            }}
            disabled={loading}
            className="rounded-xl border border-slate-600 bg-slate-800/90 px-5 py-2.5 text-sm font-medium text-slate-200 shadow-[0_2px_8px_rgba(0,0,0,0.2)] hover:border-slate-500 hover:bg-slate-700/90 disabled:opacity-50"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => {
              onApprove?.(recommendation.id);
              onClose();
            }}
            disabled={loading}
            className="rounded-xl bg-gradient-to-b from-amber-500 to-amber-600 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-[0_4px_14px_rgba(245,158,11,0.4)] hover:from-amber-400 hover:to-amber-500 disabled:opacity-50"
          >
            Approve & add to queue
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

/**
 * Reusable source editor form. Extracted from the `/sources/[id]/edit`
 * page so the same UI can be mounted either as a full page (standalone
 * edit route) or inline inside the library's center workspace panel
 * (opened from the player's Edit action on desktop routes).
 *
 * Wiring contract:
 *   - `id`            — catalog source id to fetch via `/api/sources/[id]`
 *   - `onDone`        — called after a successful save. Host decides what
 *                       "done" means (close panel, navigate, refresh RSC).
 *   - `onCancel`      — called when the user presses Cancel.
 *   - `titleAddon`    — optional small element rendered next to the title
 *                       (e.g. a close button when mounted in a panel).
 *   - `hideTopBackLink` — hide the "← Library" back link used on the full
 *                       page (the center panel owns its own chrome).
 *
 * NOTE: No routing imports here — host code owns navigation side-effects.
 * This keeps the form trivially embeddable anywhere without coupling.
 */

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "@/lib/locale-context";
import type { Source } from "@/lib/types";

type Props = {
  id: string;
  onDone: () => void;
  onCancel: () => void;
  titleAddon?: ReactNode;
  backHref?: string;
  hideTopBackLink?: boolean;
};

export function EditSourceForm({ id, onDone, onCancel, titleAddon, backHref = "/sources", hideTopBackLink = false }: Props) {
  const { t } = useTranslations();
  const [source, setSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [description, setDescription] = useState("");
  const [artworkUrl, setArtworkUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/sources/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then((data: Source) => {
        if (cancelled) return;
        setSource(data);
        setName(data.name);
        setTarget(data.target ?? "");
        setDescription(data.description ?? "");
        setArtworkUrl(data.artworkUrl ?? "");
      })
      .catch(() => {
        if (!cancelled) setError("Source not found");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!source) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/sources/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          target,
          description: description || undefined,
          artworkUrl: artworkUrl || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to update");
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update source");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-800/80 bg-slate-950/60 p-6 sm:p-8 text-center text-slate-500 min-h-[120px] flex items-center justify-center">
        Loading…
      </div>
    );
  }

  if (error || !source) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-800/80 bg-slate-950/60 p-6 sm:p-8 text-center">
        <p className="text-slate-400">{error ?? "Source not found"}</p>
        {!hideTopBackLink ? (
          <Link href={backHref} className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-sky-400 hover:bg-slate-800/80 touch-manipulation">
            {backHref === "/mobile" ? "Back to Player" : "Back to Library"}
          </Link>
        ) : (
          <button
            type="button"
            onClick={onCancel}
            className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-sky-400 hover:bg-slate-800/80 touch-manipulation"
          >
            {t.close}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 sm:space-y-6 px-4 sm:px-0 pb-8">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {!hideTopBackLink ? (
            <Link href={backHref} className="inline-flex min-h-[44px] items-center text-sm text-slate-500 hover:text-slate-300 touch-manipulation -ml-1 px-1">
              ← {backHref === "/mobile" ? "Player" : t.library}
            </Link>
          ) : null}
          <h1 className="mt-2 text-lg sm:text-xl font-semibold text-slate-50">{t.edit} {source.name}</h1>
        </div>
        {titleAddon ? <div className="shrink-0">{titleAddon}</div> : null}
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-4 sm:p-6 space-y-4"
      >
        <div>
          <label htmlFor="edit-source-name" className="block text-xs font-medium text-slate-400">
            {t.name}
          </label>
          <input
            id="edit-source-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 outline-none focus:border-sky-500 touch-manipulation"
          />
        </div>
        <div>
          <label htmlFor="edit-source-target" className="block text-xs font-medium text-slate-400">
            {t.targetUrl}
          </label>
          <input
            id="edit-source-target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            required
            className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 outline-none focus:border-sky-500 touch-manipulation"
          />
        </div>
        <div>
          <label htmlFor="edit-source-description" className="block text-xs font-medium text-slate-400">
            Description (optional)
          </label>
          <input
            id="edit-source-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 outline-none focus:border-sky-500 touch-manipulation"
          />
        </div>
        <div>
          <label htmlFor="edit-source-artwork" className="block text-xs font-medium text-slate-400">
            {t.artworkUrlOptional}
          </label>
          <input
            id="edit-source-artwork"
            type="url"
            value={artworkUrl}
            onChange={(e) => setArtworkUrl(e.target.value)}
            className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 outline-none focus:border-sky-500 touch-manipulation"
          />
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-60 touch-manipulation"
          >
            {saving ? t.saving : t.saveSource}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800 touch-manipulation"
          >
            {t.cancel}
          </button>
        </div>
      </form>
    </div>
  );
}

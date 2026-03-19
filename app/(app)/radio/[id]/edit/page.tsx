"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "@/lib/locale-context";
import type { RadioStream } from "@/lib/source-types";
import { getRadioStationsLocal } from "@/lib/radio-local-store";

export default function EditRadioPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { t } = useTranslations();
  const id = params.id as string;
  const returnTo = searchParams.get("return") || "/radio";
  const [station, setStation] = useState<RadioStream | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [genre, setGenre] = useState("Radio");
  const [cover, setCover] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/radio/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then((data: RadioStream) => {
        setStation(data);
        setName(data.name);
        setUrl(data.url);
        setGenre(data.genre ?? "Radio");
        setCover(data.cover ?? null);
      })
      .catch(() => {
        const local = getRadioStationsLocal().find((s) => s.id === id);
        if (local) {
          setStation(local);
          setName(local.name);
          setUrl(local.url);
          setGenre(local.genre ?? "Radio");
          setCover(local.cover ?? null);
        } else {
          setStation(null);
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!station) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/radio/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url, genre, cover }),
      });
      if (res.ok) {
        router.push(returnTo);
        router.refresh();
      } else {
        const err = await res.json().catch(() => ({}));
        setSaveError((err as { error?: string }).error ?? "Failed to save station");
      }
    } catch {
      setSaveError("Failed to save station");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-6 sm:p-8 text-center text-slate-500 min-h-[120px] flex items-center justify-center">
        Loading…
      </div>
    );
  }

  if (!station) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-6 sm:p-8 text-center">
        <p className="text-slate-400">Station not found</p>
        <Link href={returnTo} className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-sky-400 hover:bg-slate-800/80 touch-manipulation">
          {returnTo === "/mobile" ? "Back to Player" : "Back to Radio Streams"}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 sm:space-y-6 px-4 sm:px-0 pb-8">
      <div>
        <Link
          href={returnTo}
          className="inline-flex min-h-[44px] items-center text-sm text-slate-500 hover:text-slate-300 touch-manipulation -ml-1 px-1"
        >
          ← {returnTo === "/mobile" ? "Player" : t.radioPageTitle}
        </Link>
        <h1 className="mt-2 text-lg sm:text-xl font-semibold text-slate-50">{t.radioEdit}</h1>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-slate-800/80 bg-slate-950/50 p-4 sm:p-6">
        <div>
          <label className="block text-xs font-medium text-slate-400">{t.name}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 touch-manipulation"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400">{t.targetUrl}</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            type="url"
            className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 touch-manipulation"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400">{t.radioGenre}</label>
          <input
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 touch-manipulation"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400">Cover URL</label>
          <input
            value={cover ?? ""}
            onChange={(e) => setCover(e.target.value || null)}
            type="url"
            placeholder="https://..."
            className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 touch-manipulation"
          />
        </div>
        {saveError && (
          <p className="text-sm text-rose-400">{saveError}</p>
        )}
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] rounded-xl bg-emerald-500/90 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 touch-manipulation"
          >
            {saving ? t.saving : "Save"}
          </button>
          <Link
            href={returnTo}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800 touch-manipulation"
          >
            {t.cancel}
          </Link>
        </div>
      </form>
    </div>
  );
}

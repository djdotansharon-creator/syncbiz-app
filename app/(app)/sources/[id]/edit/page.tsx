"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "@/lib/locale-context";
import type { Source } from "@/lib/types";

export default function EditSourcePage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
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
    fetch(`/api/sources/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then((data: Source) => {
        setSource(data);
        setName(data.name);
        setTarget(data.target ?? "");
        setDescription(data.description ?? "");
        setArtworkUrl(data.artworkUrl ?? "");
      })
      .catch(() => setError("Source not found"))
      .finally(() => setLoading(false));
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
      if (!res.ok) throw new Error("Failed to update");
      router.push("/sources");
      router.refresh();
    } catch {
      setError("Failed to update source");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-800/80 bg-slate-950/60 p-8 text-center text-slate-500">
        Loading…
      </div>
    );
  }

  if (error || !source) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-800/80 bg-slate-950/60 p-8 text-center">
        <p className="text-slate-400">{error ?? "Source not found"}</p>
        <Link href="/sources" className="mt-4 inline-block text-sm text-sky-400 hover:underline">
          Back to Library
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link href="/sources" className="text-sm text-slate-500 hover:text-slate-300">
          ← {t.library}
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-50">{t.edit} {source.name}</h1>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-6 space-y-4"
      >
        <div>
          <label htmlFor="name" className="block text-xs font-medium text-slate-400">
            {t.name}
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
          />
        </div>
        <div>
          <label htmlFor="target" className="block text-xs font-medium text-slate-400">
            {t.targetUrl}
          </label>
          <input
            id="target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
          />
        </div>
        <div>
          <label htmlFor="description" className="block text-xs font-medium text-slate-400">
            Description (optional)
          </label>
          <input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
          />
        </div>
        <div>
          <label htmlFor="artworkUrl" className="block text-xs font-medium text-slate-400">
            {t.artworkUrlOptional}
          </label>
          <input
            id="artworkUrl"
            type="url"
            value={artworkUrl}
            onChange={(e) => setArtworkUrl(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
          />
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-60"
          >
            {saving ? t.saving : t.saveSource}
          </button>
          <Link
            href="/sources"
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
          >
            {t.cancel}
          </Link>
        </div>
      </form>
    </div>
  );
}

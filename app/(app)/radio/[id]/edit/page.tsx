"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "@/lib/locale-context";
import type { RadioStream } from "@/lib/source-types";

export default function EditRadioPage() {
  const router = useRouter();
  const params = useParams();
  const { t } = useTranslations();
  const id = params.id as string;
  const [station, setStation] = useState<RadioStream | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
      .catch(() => setStation(null))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!station) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/radio/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url, genre, cover }),
      });
      if (res.ok) {
        router.push("/radio");
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-8 text-center text-slate-500">
        Loading…
      </div>
    );
  }

  if (!station) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-8 text-center">
        <p className="text-slate-400">Station not found</p>
        <Link href="/radio" className="mt-4 inline-block text-sm text-sky-400 hover:underline">
          Back to Radio Streams
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link href="/radio" className="text-sm text-slate-500 hover:text-slate-300">
          ← {t.radioPageTitle}
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-50">{t.radioEdit}</h1>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-slate-800/80 bg-slate-950/50 p-6">
        <div>
          <label className="block text-xs font-medium text-slate-400">{t.name}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400">{t.targetUrl}</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            type="url"
            className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400">{t.radioGenre}</label>
          <input
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400">Cover URL</label>
          <input
            value={cover ?? ""}
            onChange={(e) => setCover(e.target.value || null)}
            type="url"
            placeholder="https://..."
            className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-50"
          />
        </div>
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-emerald-500/90 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving ? t.saving : "Save"}
          </button>
          <Link
            href="/radio"
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
          >
            {t.cancel}
          </Link>
        </div>
      </form>
    </div>
  );
}

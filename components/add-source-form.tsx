"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "@/lib/locale-context";

const SOURCE_TYPES = [
  { value: "web_url" },
  { value: "stream_url" },
  { value: "playlist_url" },
  { value: "local_playlist" },
  { value: "browser_target" },
  { value: "app_target" },
  { value: "tts" },
] as const;

function isLocalPlaylist(type: string) {
  return type === "local_playlist";
}

export function AddSourceForm() {
  const router = useRouter();
  const { t } = useTranslations();
  const [saving, setSaving] = useState(false);
  const [selectedType, setSelectedType] = useState<string>("web_url");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const name = formData.get("name") as string;
    const type = formData.get("type") as string;
    const target = (formData.get("target") as string)?.trim();
    const capabilitiesStr = (formData.get("capabilities") as string)?.trim();
    const capabilities = capabilitiesStr
      ? capabilitiesStr.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    if (!name || !type || !target) {
      setSaving(false);
      return;
    }

    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type,
          target,
          branchId: "bldn-001",
          isLive: false,
          ...(capabilities?.length ? { capabilities } : {}),
          ...(formData.get("artworkUrl") ? { artworkUrl: (formData.get("artworkUrl") as string).trim() || undefined } : {}),
        }),
      });
      if (res.ok) {
        form.reset();
        setSelectedType("web_url");
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5 space-y-4"
    >
      <h2 className="text-sm font-semibold text-slate-50">{t.addSource}</h2>
      <p className="text-xs text-slate-400">
        {t.addSourceDescription}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="block text-xs font-medium text-slate-400">
            {t.name}
          </label>
          <input
            id="name"
            name="name"
            required
            placeholder={t.placeholderMorningStream}
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30"
          />
        </div>
        <div>
          <label htmlFor="type" className="block text-xs font-medium text-slate-400">
            {t.type}
          </label>
          <select
            id="type"
            name="type"
            required
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30"
          >
            {SOURCE_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t[`sourceType_${opt.value}`] ?? opt.value}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="target" className="block text-xs font-medium text-slate-400">
          {isLocalPlaylist(selectedType) ? t.filePath : t.targetUrl}
        </label>
        <input
          id="target"
          name="target"
          type={isLocalPlaylist(selectedType) ? "text" : "url"}
          required
          placeholder={
            isLocalPlaylist(selectedType)
              ? "C:\\SyncBiz\\playlists\\store_playlist.m3u"
              : t.placeholderStream
          }
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30"
        />
        {isLocalPlaylist(selectedType) && (
          <p className="mt-1 text-xs text-slate-500">
            Supported: .m3u, .m3u8, .pls — agent will launch with system default player.
          </p>
        )}
      </div>
      <div>
        <label htmlFor="artworkUrl" className="block text-xs font-medium text-slate-400">
          {t.artworkUrlOptional}
        </label>
        <input
          id="artworkUrl"
          name="artworkUrl"
          type="url"
          placeholder={t.placeholderArtwork}
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30"
        />
      </div>
      <div>
        <label htmlFor="capabilities" className="block text-xs font-medium text-slate-400">
          {t.capabilitiesOptional}
        </label>
        <input
          id="capabilities"
          name="capabilities"
          placeholder={t.placeholderCapabilities}
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30"
        />
      </div>
      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-60"
      >
        {saving ? t.saving : t.saveSource}
      </button>
    </form>
  );
}

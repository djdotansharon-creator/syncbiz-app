"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { playlistMetadataRegistry } from "@/lib/playlist-metadata-registry";
import {
  effectivePlaylistUseCases,
  type Playlist,
  type PlaylistType,
  type PlaylistTrack,
} from "@/lib/playlist-types";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { getPlaylistsLocal } from "@/lib/playlists-local-store";

function playlistTypeLabel(t: PlaylistType): string {
  const labels: Record<PlaylistType, string> = {
    youtube: "YouTube",
    soundcloud: "SoundCloud",
    spotify: "Spotify",
    winamp: "Winamp",
    local: "Local",
    "stream-url": "Stream URL",
  };
  return labels[t];
}

function MetadataToggleChip(props: {
  id: string;
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  const { id, checked, onChange, label } = props;
  return (
    <label
      htmlFor={id}
      className="group inline-flex min-h-[32px] cursor-pointer select-none items-center gap-1.5 rounded-full border border-slate-700/45 bg-slate-900/35 px-2.5 py-[5px] text-[11px] font-normal tracking-wide text-slate-400 transition-[border-color,background-color,box-shadow,color] duration-150 touch-manipulation hover:border-slate-600/55 hover:bg-slate-800/40 hover:text-slate-300 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-emerald-500/40 has-[:checked]:border-emerald-500/30 has-[:checked]:bg-emerald-950/20 has-[:checked]:text-emerald-100/85 has-[:checked]:shadow-[inset_0_0_14px_rgba(16,185,129,0.05)]"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={() => onChange()}
        className="peer sr-only"
      />
      <span
        className="relative h-1.5 w-1.5 shrink-0 rounded-full bg-slate-600/70 transition-[background-color,box-shadow] duration-150 peer-checked:bg-emerald-400/85 peer-checked:shadow-[0_0_5px_rgba(52,211,153,0.4)]"
        aria-hidden
      />
      <span className="min-w-0 leading-snug">{label}</span>
    </label>
  );
}

export default function EditPlaylistPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const returnTo = searchParams.get("return") || "/playlists";
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [genre, setGenre] = useState("");
  const [thumbnail, setThumbnail] = useState("");
  const [type, setType] = useState<PlaylistType>("stream-url");
  const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [useCaseTags, setUseCaseTags] = useState<string[]>([]);
  const [primaryGenre, setPrimaryGenre] = useState<string>("");
  const [subGenreTags, setSubGenreTags] = useState<string[]>([]);
  const [mood, setMood] = useState<string>("");
  const [energyLevel, setEnergyLevel] = useState<string>("");

  useEffect(() => {
    fetch(`/api/playlists/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then((data: Playlist) => {
        setPlaylist(data);
        setName(data.name);
        setUrl(data.url);
        setGenre(data.genre ?? "");
        setThumbnail(data.thumbnail ?? "");
        setType(data.type);
        setAdminNotes(data.adminNotes ?? "");
        setUseCaseTags(effectivePlaylistUseCases(data));
        setPrimaryGenre(data.primaryGenre ?? "");
        setSubGenreTags([...(data.subGenres ?? [])].sort());
        setMood(data.mood ?? "");
        setEnergyLevel(data.energyLevel ?? "");
        const tracksList = getPlaylistTracks(data);
        setTracks(tracksList);
        setOrder(data.order ?? tracksList.map((t) => t.id));
      })
      .catch(async () => {
        const local = getPlaylistsLocal().find((p) => p.id === id || `pl-${p.id}` === id);
        if (local) {
          setPlaylist(local);
          setName(local.name);
          setUrl(local.url);
          setGenre(local.genre ?? "");
          setThumbnail(local.thumbnail ?? "");
          setType(local.type);
          setAdminNotes(local.adminNotes ?? "");
          setUseCaseTags(effectivePlaylistUseCases(local));
          setPrimaryGenre(local.primaryGenre ?? "");
          setSubGenreTags([...(local.subGenres ?? [])].sort());
          setMood(local.mood ?? "");
          setEnergyLevel(local.energyLevel ?? "");
          const tracksList = getPlaylistTracks(local);
          setTracks(tracksList);
          setOrder(local.order ?? tracksList.map((t) => t.id));
        } else {
          setPlaylist(null);
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!playlist) return;
    setSaving(true);
    setSaveError(null);
    try {
      const sortedUseCases = [...useCaseTags].sort();
      const sortedSubGenres = [...subGenreTags].sort();
      const payload: Record<string, unknown> = {
        name,
        url,
        genre,
        thumbnail,
        type,
        adminNotes,
        useCases: sortedUseCases,
        useCase: sortedUseCases.length > 0 ? sortedUseCases[0] : "",
        subGenres: sortedSubGenres,
        primaryGenre: primaryGenre.trim() === "" ? "" : primaryGenre,
        mood: mood.trim() === "" ? "" : mood,
        energyLevel: energyLevel.trim() === "" ? "" : energyLevel,
      };
      if (tracks.length >= 1) {
        payload.tracks = tracks;
        payload.order = order;
      }
      const res = await fetch(`/api/playlists/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        router.push(returnTo);
        router.refresh();
      } else {
        const err = await res.json().catch(() => ({}));
        setSaveError((err as { error?: string }).error ?? "Failed to save playlist");
      }
    } catch {
      setSaveError("Failed to save playlist");
    } finally {
      setSaving(false);
    }
  }

  function handleDragStart(index: number) {
    setDraggedIndex(index);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function handleDrop(e: React.DragEvent, dropIndex: number) {
    e.preventDefault();
    setDraggedIndex(null);
    if (draggedIndex === null || draggedIndex === dropIndex) return;
    const newOrder = [...order];
    const [removed] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(dropIndex, 0, removed);
    setOrder(newOrder);
  }

  function toggleUseCaseTag(uc: string) {
    setUseCaseTags((prev) => {
      const next = prev.includes(uc) ? prev.filter((x) => x !== uc) : [...prev, uc];
      return next.sort();
    });
  }

  function toggleSubGenre(sg: string) {
    setSubGenreTags((prev) => {
      const next = prev.includes(sg) ? prev.filter((x) => x !== sg) : [...prev, sg];
      return next.sort();
    });
  }

  function moveTrack(from: number, direction: 1 | -1) {
    const to = from + direction;
    if (to < 0 || to >= order.length) return;
    const newOrder = [...order];
    [newOrder[from], newOrder[to]] = [newOrder[to], newOrder[from]];
    setOrder(newOrder);
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-6 sm:p-8 text-center text-slate-500 min-h-[120px] flex items-center justify-center">
        Loading…
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-6 sm:p-8 text-center">
        <p className="text-slate-400">Playlist not found</p>
        <Link href={returnTo} className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-sky-400 hover:bg-slate-800/80 touch-manipulation">
          {returnTo === "/mobile" ? "Back to Player" : "Back to Playlists"}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 sm:space-y-6 px-4 sm:px-0 pb-8">
      <div>
        <Link href={returnTo} className="inline-flex min-h-[44px] items-center text-sm text-slate-500 hover:text-slate-300 touch-manipulation -ml-1 px-1">
          ← {returnTo === "/mobile" ? "Player" : "Playlists"}
        </Link>
        <h1 className="mt-2 text-lg sm:text-xl font-semibold text-slate-50">Edit playlist</h1>
      </div>

      <div className="flex gap-3 sm:gap-4 rounded-2xl border border-slate-800/90 bg-gradient-to-br from-slate-900/95 via-slate-950/90 to-slate-950 p-3.5 sm:p-4 ring-1 ring-white/[0.05] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
        <div className="relative h-[4.5rem] w-[4.5rem] sm:h-[5rem] sm:w-[5rem] shrink-0 overflow-hidden rounded-xl border border-slate-700/80 bg-slate-800/90 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.35)]">
          {thumbnail.trim() ? (
            // User-provided URL; avoid next/image domain allowlist for edit preview.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnail} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-slate-800 text-lg font-bold tabular-nums text-slate-500">
              {(name.trim().charAt(0) || "?").toUpperCase()}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 py-0.5">
          <p className="truncate text-[15px] font-semibold tracking-tight text-slate-100 sm:text-base" title={name}>
            {name.trim() || "Untitled playlist"}
          </p>
          <p className="truncate font-mono text-[11px] leading-snug text-slate-500" title={url}>
            {url.trim() || "No URL yet"}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <span className="inline-flex w-fit items-center rounded-md border border-emerald-500/25 bg-emerald-950/35 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-300/95 shadow-[0_0_12px_rgba(16,185,129,0.12)]">
              {playlistTypeLabel(type)}
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-slate-600">On deck</span>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-4 sm:p-6 space-y-4 min-w-0">
        <div>
          <label className="block text-xs font-medium text-slate-400">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 touch-manipulation"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400">URL</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 touch-manipulation"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400">Genre</label>
          <input
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 touch-manipulation"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as PlaylistType)}
            className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 touch-manipulation"
          >
            <option value="youtube">YouTube</option>
            <option value="soundcloud">SoundCloud</option>
            <option value="spotify">Spotify</option>
            <option value="winamp">Winamp</option>
            <option value="local">Local</option>
            <option value="stream-url">Stream URL</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400">Thumbnail URL</label>
          <input
            value={thumbnail}
            onChange={(e) => setThumbnail(e.target.value)}
            className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 touch-manipulation"
          />
        </div>
        <div className="rounded-2xl border border-slate-800/90 bg-slate-950/60 p-4 sm:p-5 space-y-5 ring-1 ring-white/[0.04]">
          <div>
            <h2 className="text-sm font-semibold text-slate-200 tracking-tight">How this playlist fits the mix</h2>
            <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
              Tags help you find and filter playlists in the library. Saved keys stay compact; labels here are for clarity only.
            </p>
          </div>
          <div>
            <span className="block text-xs font-medium text-slate-300">Playback context</span>
            <p className="mt-0.5 text-[11px] text-slate-500">Choose every context that applies.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {playlistMetadataRegistry.useCases.map((opt) => (
                <MetadataToggleChip
                  key={opt.value}
                  id={`edit-pl-uc-${opt.value}`}
                  checked={useCaseTags.includes(opt.value)}
                  onChange={() => toggleUseCaseTag(opt.value)}
                  label={opt.label}
                />
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300">Main sound</label>
            <p className="mt-0.5 text-[11px] text-slate-500">Primary genre for this list.</p>
            <select
              value={primaryGenre}
              onChange={(e) => setPrimaryGenre(e.target.value)}
              className="mt-2 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 touch-manipulation"
            >
              <option value="">Not set</option>
              {playlistMetadataRegistry.primaryGenres.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="block text-xs font-medium text-slate-300">Extra style tags</span>
            <p className="mt-0.5 text-[11px] text-slate-500">Layer sub-styles for smarter filters.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {playlistMetadataRegistry.subGenres.map((opt) => (
                <MetadataToggleChip
                  key={opt.value}
                  id={`edit-pl-sg-${opt.value}`}
                  checked={subGenreTags.includes(opt.value)}
                  onChange={() => toggleSubGenre(opt.value)}
                  label={opt.label}
                />
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300">Vibe</label>
            <p className="mt-0.5 text-[11px] text-slate-500">Overall mood of the set.</p>
            <select
              value={mood}
              onChange={(e) => setMood(e.target.value)}
              className="mt-2 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 touch-manipulation"
            >
              <option value="">Not set</option>
              {playlistMetadataRegistry.moods.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300">Energy</label>
            <p className="mt-0.5 text-[11px] text-slate-500">How hard the list drives the room.</p>
            <select
              value={energyLevel}
              onChange={(e) => setEnergyLevel(e.target.value)}
              className="mt-2 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 touch-manipulation"
            >
              <option value="">Not set</option>
              {playlistMetadataRegistry.energyLevels.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-300">Team notes</label>
          <p className="mt-0.5 text-[11px] text-slate-500">Optional — for your crew only; not shown on the deck.</p>
          <textarea
            value={adminNotes}
            onChange={(e) => setAdminNotes(e.target.value)}
            rows={4}
            className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-base sm:text-sm text-slate-50 touch-manipulation resize-y min-h-[100px]"
            placeholder="Curation notes, DO NOT PLAY lines, client requests…"
          />
        </div>
        {tracks.length > 1 && (
          <div>
            <label className="block text-xs font-medium text-slate-400">Tracks (reorder)</label>
            <p className="mt-0.5 text-[11px] text-slate-500 sm:hidden">Use ↑↓ to reorder on mobile</p>
            <div className="mt-2 max-h-[40vh] overflow-y-auto space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-2">
              {order
                .map((tid) => tracks.find((t) => t.id === tid))
                .filter(Boolean)
                .map((track, idx) => (
                  <div
                    key={track!.id}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, idx)}
                    className={`flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-900/60 px-3 py-2.5 sm:py-2 min-h-[48px] ${
                      draggedIndex === idx ? "opacity-50" : ""
                    }`}
                  >
                    <span className="hidden sm:inline cursor-grab text-slate-500 select-none" aria-hidden>
                      ⋮⋮
                    </span>
                    <div className="flex sm:hidden shrink-0 gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveTrack(idx, -1)}
                        disabled={idx === 0}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-600 bg-slate-800/80 text-slate-400 disabled:opacity-40 disabled:pointer-events-none touch-manipulation"
                        aria-label="Move up"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 15l-6-6-6 6" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => moveTrack(idx, 1)}
                        disabled={idx === order.length - 1}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-600 bg-slate-800/80 text-slate-400 disabled:opacity-40 disabled:pointer-events-none touch-manipulation"
                        aria-label="Move down"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>
                    </div>
                    <span className="flex-1 min-w-0 truncate text-sm text-slate-200">{track!.name}</span>
                    <span className="shrink-0 text-xs text-slate-500">{track!.type}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
        {saveError && (
          <p className="text-sm text-rose-400">{saveError}</p>
        )}
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] rounded-xl bg-[#1db954] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#1ed760] disabled:opacity-50 touch-manipulation"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <Link
            href={returnTo}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800 touch-manipulation"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

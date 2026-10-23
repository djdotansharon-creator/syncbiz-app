"use client";

/**
 * Reusable playlist editor form. Extracted from the
 * `/playlists/[id]/edit` page so the same UI can be mounted either as
 * a full page (standalone edit route) or inline inside the library's
 * center workspace panel (opened from the player's Edit action).
 *
 * Wiring contract: see `EditSourceForm` — same shape. No routing hooks
 * here; the host decides what happens after save / cancel.
 */

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { GlassModal, type GlassModalStep } from "@/components/glass-modal";
import { playlistMetadataRegistry } from "@/lib/playlist-metadata-registry";
import {
  effectivePlaylistUseCases,
  type Playlist,
  type PlaylistType,
  type PlaylistTrack,
} from "@/lib/playlist-types";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { getPlaylistsLocal } from "@/lib/playlists-local-store";
import {
  PLAYLIST_PUBLICATION_SCOPE_UI,
  PLAYLIST_PUBLICATION_SCOPES,
  publicationScopeRequiresPlatformAdmin,
  type PlaylistPublicationScope,
} from "@/lib/playlist-publication-scope";
import { useTr } from "@/lib/i18n/use-tr";

/** Publication scopes editable by workspace users without platform SUPER_ADMIN. */
const WORKSPACE_PUBLICATION_SCOPES: PlaylistPublicationScope[] = [
  "PRIVATE",
  "LINK_SHARED",
  "COMMUNITY_PUBLISHED",
  "FORK_REMIX",
];

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

/* ── Wizard "Style" step helpers (2026-10-16): few options at a time, "+N" to expand, minimal line icons ── */
const ico = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);
const CONTEXT_ICONS: Record<string, ReactNode> = {
  retail: ico(<><path d="M6 8h12l-1 12H7L6 8z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>),
  restaurant: ico(<><path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10" /><path d="M16 21V3c-2 1.5-3 4-3 7h3" /></>),
  cafe: ico(<><path d="M5 9h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9z" /><path d="M16 10h2a2 2 0 0 1 0 4h-2M8 4v2M12 4v2" /></>),
  gym: ico(<path d="M6 8v8M3 10v4M18 8v8M21 10v4M6 12h12" />),
  office: ico(<><rect x="4" y="8" width="16" height="11" rx="2" /><path d="M9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M4 13h16" /></>),
  lounge: ico(<><path d="M4 12V9a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3" /><path d="M2 14a2 2 0 0 1 4 0v2h12v-2a2 2 0 0 1 4 0v4H2v-4zM6 18v2M18 18v2" /></>),
  event: ico(<><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" /></>),
  wedding: ico(<><circle cx="9" cy="14" r="4.5" /><circle cx="15" cy="14" r="4.5" /><path d="M12 6l-1.5-2h3L12 6z" /></>),
  weekend: ico(<><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></>),
  warmup: ico(<path d="M3 18h18M6 18a6 6 0 0 1 12 0M12 6v3M4.9 9.9l1.5 1.5M19.1 9.9l-1.5 1.5" />),
  peak: ico(<path d="M3 19l6-10 4 6 3-4 5 8H3z" />),
  closing: ico(<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />),
};
const MOOD_ICONS: Record<string, ReactNode> = {
  chill: ico(<path d="M3 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0" />),
  uplifting: ico(<path d="M12 3l2.2 5.2L20 9l-4.2 3.8L17 18l-5-2.9L7 18l1.2-5.2L4 9l5.8-.8L12 3z" />),
  emotional: ico(<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" />),
  warm: ico(<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z" />),
  dark: ico(<path d="M12 4a8 8 0 1 0 0 16V4z" />),
  sexy: ico(<><path d="M3 12c3-4 6-4 9-2 3-2 6-2 9 2-3 4-6 6-9 6s-6-2-9-6z" /><path d="M3 12h18" /></>),
  elegant: ico(<path d="M6 4h12l3 5-9 11L3 9l3-5zM3 9h18M9 4l3 5 3-5" />),
  happy: ico(<><circle cx="12" cy="12" r="9" /><path d="M8 14c1 1.5 2.3 2 4 2s3-.5 4-2M9 9.5h.01M15 9.5h.01" /></>),
  dramatic: ico(<path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z" />),
  spiritual: ico(<><path d="M12 4v4M12 16v4M4 12h4M16 12h4" /><circle cx="12" cy="12" r="2" /></>),
};

const PLAYLIST_TYPE_OPTIONS = [
  { value: "youtube", label: "YouTube" },
  { value: "soundcloud", label: "SoundCloud" },
  { value: "spotify", label: "Spotify" },
  { value: "winamp", label: "Winamp" },
  { value: "local", label: "Local" },
  { value: "stream-url", label: "Stream URL" },
] as const;

function ChipGroup({
  items,
  selected,
  onPick,
  icons,
  limit,
}: {
  items: readonly { readonly value: string; readonly label: string }[];
  selected: readonly string[];
  onPick: (value: string) => void;
  icons?: Record<string, ReactNode>;
  limit: number;
}) {
  const tr = useTr();
  const [open, setOpen] = useState(false);
  // a selected option is never hidden behind "+N"
  const shown = items.filter((it, i) => i < limit || selected.includes(it.value));
  const extra = items.filter((it) => !shown.includes(it));
  const chip = (it: { value: string; label: string }) => (
    <button key={it.value} type="button" className={`sb-wz-chip${selected.includes(it.value) ? " is-on" : ""}`} aria-pressed={selected.includes(it.value)} onClick={() => onPick(it.value)}>
      {icons?.[it.value] ? <span className="sb-wz-chip-ic">{icons[it.value]}</span> : null}
      {tr(it.label)}
    </button>
  );
  return (
    <div>
      <div className="sb-wz-chips">
        {shown.map(chip)}
        {extra.length > 0 ? (
          <button type="button" className="sb-wz-chip sb-wz-chip--more" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "Less" : `+${extra.length}`}
          </button>
        ) : null}
      </div>
      {extra.length > 0 ? (
        <div className={`sb-wz-more${open ? " is-open" : ""}`} aria-hidden={!open}>
          <div className="sb-wz-more-inner">
            <div className="sb-wz-chips">{extra.map(chip)}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type Props = {
  id: string;
  onDone: () => void;
  onCancel: () => void;
  titleAddon?: ReactNode;
  backHref?: string;
  hideTopBackLink?: boolean;
  /** "wizard" = the stepped centred glass dialog (2026-10-16); default "page" keeps the original layout. */
  presentation?: "page" | "wizard";
  /** Wizard only: the host's exit animation is running. */
  modalClosing?: boolean;
};

export function EditPlaylistForm({ id, onDone, onCancel, titleAddon, backHref = "/playlists", hideTopBackLink = false, presentation = "page", modalClosing }: Props) {
  const tr = useTr();
  const [step, setStep] = useState(0);
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
  const [publicationScope, setPublicationScope] = useState<PlaylistPublicationScope>("PRIVATE");
  const [platformSuperAdmin, setPlatformSuperAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data: { isPlatformSuperAdmin?: boolean }) => {
        if (!cancelled) setPlatformSuperAdmin(Boolean(data.isPlatformSuperAdmin));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/playlists/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then((data: Playlist) => {
        if (cancelled) return;
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
        setPublicationScope(data.publicationScope ?? "PRIVATE");
        const tracksList = getPlaylistTracks(data);
        setTracks(tracksList);
        setOrder(data.order ?? tracksList.map((t) => t.id));
      })
      .catch(async () => {
        if (cancelled) return;
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
          setPublicationScope(local.publicationScope ?? "PRIVATE");
          const tracksList = getPlaylistTracks(local);
          setTracks(tracksList);
          setOrder(local.order ?? tracksList.map((t) => t.id));
        } else {
          setPlaylist(null);
        }
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
      const scopeLocked =
        playlist.publicationScope != null &&
        publicationScopeRequiresPlatformAdmin(playlist.publicationScope) &&
        !platformSuperAdmin;
      if (!scopeLocked) {
        payload.publicationScope = publicationScope;
      }
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
        onDone();
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

  if (presentation === "wizard") {
    if (loading || !playlist) {
      return (
        <GlassModal title={tr("Edit playlist")} width={420} closing={modalClosing} closeOnBackdrop={false} onClose={onCancel}>
          <p className="sb-wz-hint" style={{ textAlign: "center", padding: "28px 0" }}>{loading ? tr("Loading…") : tr("Playlist not found")}</p>
        </GlassModal>
      );
    }
    const steps: GlassModalStep[] = [
      { key: "details", label: tr("Details") },
      ...(tracks.length > 1 ? [{ key: "tracks", label: tr("Tracks") }] : []),
      { key: "style", label: tr("Style") },
      { key: "visibility", label: tr("Visibility") },
    ];
    const at = Math.min(step, steps.length - 1);
    const cur = steps[at]!.key;
    const last = at === steps.length - 1;
    const scopeLocked =
      playlist.publicationScope != null &&
      publicationScopeRequiresPlatformAdmin(playlist.publicationScope) &&
      !platformSuperAdmin;
    const submit = () => {
      if (!name.trim() || !url.trim()) {
        setStep(0);
        setSaveError(tr("Name and URL are required"));
        return;
      }
      void handleSubmit({ preventDefault() {} } as React.FormEvent);
    };
    return (
      <GlassModal
        title={tr("Edit playlist")}
        subtitle={name.trim() || tr("Untitled playlist")}
        showInitial
        cover={thumbnail.trim() || null}
        steps={steps}
        step={at}
        onStep={setStep}
        width={680}
        closing={modalClosing}
        closeOnBackdrop={false}
        onClose={onCancel}
        footer={
          <>
            <button type="button" className="sb-wz-btn" onClick={onCancel}>{tr("Cancel")}</button>
            <span className="sb-wz-spacer" />
            {at > 0 ? <button type="button" className="sb-wz-btn" onClick={() => setStep(at - 1)}>{tr("Back")}</button> : null}
            {/* round 8 (owner): Next only, until the very last step — that is where Save is */}
            {!last ? (
              <button type="button" className="sb-wz-btn sb-wz-btn--primary" onClick={() => setStep(at + 1)}>{tr("Next")}</button>
            ) : (
              <button type="button" className="sb-wz-btn sb-wz-btn--primary" disabled={saving} onClick={submit}>{saving ? tr("Saving…") : tr("Save")}</button>
            )}
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (last) submit();
            else setStep(at + 1);
          }}
        >
          {cur === "details" ? (
            <div className="sb-wz-grid2">
              <div className="sb-wz-field sb-wz-span2">
                <label className="sb-wz-label">{tr("Name")}</label>
                <input className="sb-wz-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </div>
              <div className="sb-wz-field sb-wz-span2">
                <label className="sb-wz-label">{tr("URL")}</label>
                <input className="sb-wz-input" value={url} onChange={(e) => setUrl(e.target.value)} />
              </div>
              <div className="sb-wz-field">
                <label className="sb-wz-label">{tr("Genre")}</label>
                <input className="sb-wz-input" value={genre} onChange={(e) => setGenre(e.target.value)} />
              </div>
              <div className="sb-wz-field">
                <label className="sb-wz-label">{tr("Thumbnail URL")}</label>
                <input className="sb-wz-input" value={thumbnail} onChange={(e) => setThumbnail(e.target.value)} />
              </div>
              <div className="sb-wz-field sb-wz-span2">
                <label className="sb-wz-label">{tr("Type")}</label>
                <ChipGroup
                  items={PLAYLIST_TYPE_OPTIONS}
                  selected={[type]}
                  onPick={(v) => setType(v as PlaylistType)}
                  limit={6}
                />
              </div>
            </div>
          ) : null}
          {cur === "tracks" ? (
            <>
              <p className="sb-wz-hint" style={{ margin: "0 2px 10px" }}>{tr("Drag a track to change the order.")}</p>
              <div className="sb-wz-rows">
                {order.map((tid, idx) => {
                  const track = tracks.find((t2) => t2.id === tid);
                  if (!track) return null;
                  return (
                    <div
                      key={`${idx}-${tid}`}
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, idx)}
                      className={`sb-wz-row${draggedIndex === idx ? " is-drag" : ""}`}
                    >
                      <span className="sb-wz-grip" aria-hidden>⋮⋮</span>
                      <span className="sb-wz-row-name" title={track.name}>{track.name}</span>
                      <span className="sb-wz-row-type">{track.type}</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
          {cur === "style" ? (
            <div className="sb-wz-grid2" style={{ alignItems: "start" }}>
              <div className="sb-wz-stack">
                <div className="sb-wz-field">
                  <span className="sb-wz-label">{tr("Playback context")}</span>
                  <ChipGroup items={playlistMetadataRegistry.useCases} selected={useCaseTags} onPick={toggleUseCaseTag} icons={CONTEXT_ICONS} limit={6} />
                </div>
                <div className="sb-wz-field">
                  <span className="sb-wz-label">{tr("Sub-styles")}</span>
                  <ChipGroup items={playlistMetadataRegistry.subGenres} selected={subGenreTags} onPick={toggleSubGenre} limit={3} />
                </div>
              </div>
              <div className="sb-wz-stack">
                <div className="sb-wz-field">
                  <span className="sb-wz-label">{tr("Main sound")}</span>
                  <ChipGroup items={playlistMetadataRegistry.primaryGenres} selected={primaryGenre ? [primaryGenre] : []} onPick={(v) => setPrimaryGenre(primaryGenre === v ? "" : v)} limit={4} />
                </div>
                <div className="sb-wz-field">
                  <span className="sb-wz-label">{tr("Vibe")}</span>
                  <ChipGroup items={playlistMetadataRegistry.moods} selected={mood ? [mood] : []} onPick={(v) => setMood(mood === v ? "" : v)} icons={MOOD_ICONS} limit={4} />
                </div>
                <div className="sb-wz-field">
                  <span className="sb-wz-label">{tr("Energy")}</span>
                  <div className="sb-wz-seg" role="radiogroup" aria-label={tr("Energy")}>
                    {playlistMetadataRegistry.energyLevels.map((e, i) => (
                      <button key={e.value} type="button" role="radio" aria-checked={energyLevel === e.value} className={energyLevel === e.value ? "is-on" : ""} onClick={() => setEnergyLevel(energyLevel === e.value ? "" : e.value)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                          <path d="M6 19v-3" opacity={i >= 0 ? 1 : 0.3} />
                          <path d="M12 19v-7" opacity={i >= 1 ? 1 : 0.25} />
                          <path d="M18 19V7" opacity={i >= 2 ? 1 : 0.25} />
                        </svg>
                        {tr(e.label)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {cur === "visibility" ? (
            <div className="sb-wz-stack">
              <div className="sb-wz-field">
                <label className="sb-wz-label">{tr("Who can discover this playlist")}</label>
                {scopeLocked ? (
                  <p className="sb-wz-hint" style={{ margin: 0 }}>
                    {tr(PLAYLIST_PUBLICATION_SCOPE_UI[playlist.publicationScope!].label)} — {tr("only platform admins can change this.")}
                  </p>
                ) : (
                  <>
                    <ChipGroup
                      items={(platformSuperAdmin ? PLAYLIST_PUBLICATION_SCOPES : WORKSPACE_PUBLICATION_SCOPES).map((scope) => ({ value: scope, label: PLAYLIST_PUBLICATION_SCOPE_UI[scope].label }))}
                      selected={[publicationScope]}
                      onPick={(v) => setPublicationScope(v as PlaylistPublicationScope)}
                      limit={6}
                    />
                    <p className="sb-wz-hint">{tr(PLAYLIST_PUBLICATION_SCOPE_UI[publicationScope]?.description ?? "")}</p>
                  </>
                )}
              </div>
              <div className="sb-wz-field">
                <label className="sb-wz-label">{tr("Team notes")}</label>
                <textarea className="sb-wz-input" value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} placeholder={tr("Curation notes, DO NOT PLAY lines, client requests…")} />
                <p className="sb-wz-hint">{tr("For your crew only — not shown on the deck.")}</p>
              </div>
            </div>
          ) : null}
          {saveError ? <p className="sb-wz-error">{saveError}</p> : null}
        </form>
      </GlassModal>
    );
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
        {!hideTopBackLink ? (
          <Link href={backHref} className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-sky-400 hover:bg-slate-800/80 touch-manipulation">
            {backHref === "/mobile" ? "Back to Player" : "Back to Playlists"}
          </Link>
        ) : (
          <button
            type="button"
            onClick={onCancel}
            className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-sky-400 hover:bg-slate-800/80 touch-manipulation"
          >
            Close
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 sm:space-y-6 px-4 sm:px-0 pb-8">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {!hideTopBackLink ? (
            <Link href={backHref} className="inline-flex min-h-[44px] items-center text-sm text-slate-500 hover:text-slate-300 touch-manipulation -ml-1 px-1">
              ← {backHref === "/mobile" ? "Player" : "Playlists"}
            </Link>
          ) : null}
          <h1 className="mt-2 text-lg sm:text-xl font-semibold text-slate-50">Edit playlist</h1>
        </div>
        {titleAddon ? <div className="shrink-0">{titleAddon}</div> : null}
      </div>

      <div className="flex gap-3 sm:gap-4 rounded-2xl border border-slate-800/90 bg-gradient-to-br from-slate-900/95 via-slate-950/90 to-slate-950 p-3.5 sm:p-4 ring-1 ring-white/[0.05] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
        <div className="relative h-[4.5rem] w-[4.5rem] sm:h-[5rem] sm:w-[5rem] shrink-0 overflow-hidden rounded-xl border border-slate-700/80 bg-slate-800/90 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.35)]">
          {thumbnail.trim() ? (
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
        <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-4 space-y-2">
          <h2 className="text-sm font-semibold text-slate-200">Publishing & visibility</h2>
          <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
            Who can discover this playlist beyond your workspace when discovery ships. Separate from branch vs personal library.
          </p>
          {playlist.publicationScope != null &&
          publicationScopeRequiresPlatformAdmin(playlist.publicationScope) &&
          !platformSuperAdmin ? (
            <div className="rounded-lg border border-slate-700/80 bg-slate-900/50 px-3 py-2 text-sm text-slate-300">
              <span className="font-medium">
                {PLAYLIST_PUBLICATION_SCOPE_UI[playlist.publicationScope].label}
              </span>
              <p className="mt-1 text-[11px] text-slate-500">
                {PLAYLIST_PUBLICATION_SCOPE_UI[playlist.publicationScope].description}
              </p>
              <p className="mt-2 text-[11px] text-amber-200/90">
                Only SyncBiz platform admins can change this publication scope.
              </p>
            </div>
          ) : (
            <>
              <label className="block text-xs font-medium text-slate-400">Publication scope</label>
              <select
                value={publicationScope}
                onChange={(e) => setPublicationScope(e.target.value as PlaylistPublicationScope)}
                className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 touch-manipulation"
              >
                {(platformSuperAdmin ? PLAYLIST_PUBLICATION_SCOPES : WORKSPACE_PUBLICATION_SCOPES).map((scope) => (
                  <option key={scope} value={scope}>
                    {PLAYLIST_PUBLICATION_SCOPE_UI[scope].label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500">
                {PLAYLIST_PUBLICATION_SCOPE_UI[publicationScope]?.description ?? ""}
              </p>
            </>
          )}
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
              {order.map((tid, idx) => {
                const track = tracks.find((t) => t.id === tid);
                if (!track) return null;
                return (
                  <div
                    key={`${idx}-${tid}`}
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
                    <span className="flex-1 min-w-0 truncate text-sm text-slate-200">{track.name}</span>
                    <span className="shrink-0 text-xs text-slate-500">{track.type}</span>
                  </div>
                );
              })}
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
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800 touch-manipulation"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

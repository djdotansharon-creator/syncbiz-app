"use client";

/**
 * Per-track metadata chips. Visible across the playlist track list, mobile
 * playlist rows, and the Now Playing hero in the player. Reads from a shared
 * resolver so the priority chain is identical everywhere:
 *
 *   1. AI-builder fields on the track itself (genre / mood / subGenres)
 *   2. Session cache populated from the AI build API response
 *   3. Parent playlist taxonomy
 *   4. Localized "Unclassified" fallback
 *
 * The component never exposes local file paths. The optional "data came from"
 * operator-only marker is rendered only when `showOperatorReason` is set.
 */

import { useLocale } from "@/lib/locale-context";
import {
  resolveTrackDisplayMetadata,
  type SessionTrackMetaCache,
} from "@/lib/playlist-track-display-meta";
import type { Playlist, PlaylistTrack } from "@/lib/playlist-types";

type Density = "compact" | "default" | "hero";

const METADATA_SOURCE_LABEL_EN: Record<string, string> = {
  local_id3: "ID3",
  local_xlsx: "XLSX",
  catalog: "Catalog tag",
  playlist: "Playlist",
  fallback: "Default",
};
const METADATA_SOURCE_LABEL_HE: Record<string, string> = {
  local_id3: "ID3",
  local_xlsx: "XLSX",
  catalog: "תיוג קטלוג",
  playlist: "פלייליסט",
  fallback: "ברירת מחדל",
};

const SOURCE_PILL_TONE: Record<string, string> = {
  local: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  catalog: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  youtube: "border-rose-500/40 bg-rose-500/10 text-rose-200",
  soundcloud: "border-orange-500/40 bg-orange-500/10 text-orange-200",
  spotify: "border-green-500/40 bg-green-500/10 text-green-200",
  stream: "border-sky-500/40 bg-sky-500/10 text-sky-200",
  other: "border-slate-600/60 bg-slate-700/30 text-slate-300",
};

const GENRE_PILL_TONE = "border-indigo-500/40 bg-indigo-500/10 text-indigo-200";
const MOOD_PILL_TONE = "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200";
const SUBGENRE_PILL_TONE = "border-slate-600/60 bg-slate-800/60 text-slate-300";
const UNCLASSIFIED_PILL_TONE = "border-slate-700/60 bg-slate-900/60 text-slate-500";

function pillClass(tone: string, density: Density): string {
  const base =
    "inline-flex shrink-0 items-center rounded-full border font-medium uppercase tracking-wide";
  const size =
    density === "compact"
      ? "px-1.5 py-0.5 text-[9px]"
      : density === "hero"
        ? "px-2 py-0.5 text-[10px] sm:text-[11px]"
        : "px-1.5 py-0.5 text-[10px]";
  return `${base} ${size} ${tone}`;
}

export type TrackMetaChipsProps = {
  track: Pick<
    PlaylistTrack,
    "id" | "type" | "catalogItemId" | "genre" | "mood" | "subGenres" | "metadataSource"
  >;
  parentPlaylist?: Partial<
    Pick<Playlist, "primaryGenre" | "subGenres" | "mood" | "genre">
  > | null;
  trackMetaCache?: SessionTrackMetaCache | null;
  density?: Density;
  /** Show "Local / Catalog / YouTube" provenance pill. Defaults to true. */
  showSource?: boolean;
  /** Hide the genre/mood chips and show only the source pill. */
  sourceOnly?: boolean;
  /** Operator-only: append "(ID3)" / "(Catalog tag)" suffix. */
  showOperatorReason?: boolean;
  className?: string;
  /** When true, render an "Unclassified" pill when no taxonomy is found. */
  showUnclassifiedFallback?: boolean;
};

export function TrackMetaChips({
  track,
  parentPlaylist = null,
  trackMetaCache = null,
  density = "default",
  showSource = true,
  sourceOnly = false,
  showOperatorReason = false,
  className,
  showUnclassifiedFallback = true,
}: TrackMetaChipsProps) {
  const { locale } = useLocale();
  const meta = resolveTrackDisplayMetadata(track, {
    parentPlaylist,
    trackMetaCache,
    locale,
  });

  const chips: Array<{ key: string; label: string; tone: string }> = [];
  if (showSource) {
    chips.push({
      key: "source",
      label: meta.sourceLabel,
      tone: SOURCE_PILL_TONE[meta.sourceKind] ?? SOURCE_PILL_TONE.other,
    });
  }
  if (!sourceOnly) {
    if (meta.genreChip) {
      chips.push({ key: "genre", label: meta.genreChip, tone: GENRE_PILL_TONE });
    }
    if (meta.moodChip) {
      chips.push({ key: "mood", label: meta.moodChip, tone: MOOD_PILL_TONE });
    }
    for (const sub of meta.subGenreChips) {
      chips.push({ key: `sub-${sub}`, label: sub, tone: SUBGENRE_PILL_TONE });
    }
    if (!meta.genreChip && !meta.moodChip && meta.subGenreChips.length === 0 && showUnclassifiedFallback) {
      chips.push({
        key: "unclassified",
        label: meta.unclassifiedLabel,
        tone: UNCLASSIFIED_PILL_TONE,
      });
    }
  }

  if (chips.length === 0) return null;

  const operatorSuffix =
    showOperatorReason && meta.metadataSource
      ? locale === "he"
        ? METADATA_SOURCE_LABEL_HE[meta.metadataSource]
        : METADATA_SOURCE_LABEL_EN[meta.metadataSource]
      : null;

  return (
    <div
      className={`flex flex-wrap items-center gap-1 ${className ?? ""}`}
      data-track-meta-source={meta.metadataSource ?? undefined}
    >
      {chips.map((chip) => (
        <span key={chip.key} className={pillClass(chip.tone, density)}>
          {chip.label}
        </span>
      ))}
      {operatorSuffix ? (
        <span
          className="text-[9px] uppercase tracking-wide text-slate-500"
          title={locale === "he" ? "מקור הנתון" : "Tag source"}
        >
          · {operatorSuffix}
        </span>
      ) : null}
    </div>
  );
}

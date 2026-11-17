"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { useMobileFleet } from "@/lib/mobile-fleet";
import { useTr } from "@/lib/i18n/use-tr";
import { useVmUi } from "@/components/vm/vm-ui";
import { VmCover, VmEq, fmtTime } from "@/components/vm/vm-parts";
import { useOpenActions, type VmActionSpec } from "@/components/vm/vm-actions";
import { IconChevronForward, IconMore, IconPause, IconPlay, IconUpNext } from "@/components/vm/vm-icons";
import { getPlaylistTracks, type Playlist } from "@/lib/playlist-types";
import type { UnifiedSource } from "@/lib/source-types";

/** What the phone shows for a library item: a playlist's cover (or its first song's), its length in songs, or a single song's provider. */
export function sourceCover(s: UnifiedSource): string | null {
  if (s.cover) return s.cover;
  const t = s.playlist?.tracks?.find((x) => x.cover);
  return t?.cover ?? null;
}

/** a playlist's length in seconds when every song's is known (else the playlist's own); null = not known */
export function playlistSeconds(p: Playlist | null | undefined): number | null {
  if (!p) return null;
  const tracks = p.tracks ?? [];
  const known = (t: { durationSeconds?: number | null }) => typeof t.durationSeconds === "number" && t.durationSeconds > 0;
  if (tracks.length > 0 && tracks.every(known)) return tracks.reduce((a, t) => a + (t.durationSeconds as number), 0);
  return typeof p.durationSeconds === "number" && p.durationSeconds > 0 ? p.durationSeconds : null;
}

/**
 * Sending music to the OPEN branch, with the rules every screen shares: nothing open → the branch picker; the branch offline → a toast; otherwise the command goes out and a
 * toast says where. (A function that reads the latest state when it runs — a menu opened a moment ago still acts on what is true now.)
 */
export function useSendSource() {
  const f = useMobileFleet();
  const tr = useTr();
  const ui = useVmUi();
  const fRef = useRef(f);
  useEffect(() => {
    fRef.current = f;
  });
  return useMemo(() => {
    const guard = (): boolean => {
      const cur = fRef.current;
      if (!cur.selected) {
        ui.openPicker();
        return false;
      }
      if (!cur.canControl) {
        ui.toast(tr("{name} is offline", { name: cur.selected.name }));
        return false;
      }
      return true;
    };
    return {
      guard,
      playNow: (source: UnifiedSource) => {
        if (!guard()) return;
        fRef.current.playSource(source);
        ui.toast(tr("Playing on {name}", { name: fRef.current.selected!.name }));
      },
      playNext: (source: UnifiedSource) => {
        if (!guard()) return;
        fRef.current.queueNext(source);
        ui.toast(tr("Will play next on {name}", { name: fRef.current.selected!.name }));
      },
      pause: () => {
        if (guard()) fRef.current.pause();
      },
    };
  }, [tr, ui]);
}

/** the name a provider is known by (a brand's name is not translated) */
function providerLabel(type: UnifiedSource["type"], tr: (s: string) => string): string | null {
  switch (type) {
    case "youtube": return "YouTube";
    case "soundcloud": return "SoundCloud";
    case "spotify": return "Spotify";
    case "winamp": return "Winamp";
    case "local": return tr("Local file");
    case "stream-url": return tr("Stream");
    default: return null;
  }
}

/**
 * A library row (owner 2026-11-17): TAPPING A SONG PLAYS IT on the open branch (a 1-song playlist is a song); a playlist of several songs opens its songs instead (the chevron).
 * No round buttons: one ⋯ opens the row's menu (play now / play next / details). The song that plays now shows the live bars and is lifted off the screen — no frame, no label.
 * Tapping the playing song opens the player (never an interruption of a live store).
 */
export function VmSourceRow({ source, href }: { source: UnifiedSource; href?: string | null }) {
  const f = useMobileFleet();
  const tr = useTr();
  const ui = useVmUi();
  const send = useSendSource();
  const openActions = useOpenActions();
  const shown = f.display.shown;
  const active = !!shown && shown.status === "playing" && (shown.currentSource?.id === source.id || shown.currentSource?.id?.startsWith(`${source.id}:`) === true);
  const isPlaylist = source.origin === "playlist";
  const count = isPlaylist && source.playlist ? getPlaylistTracks(source.playlist).length : 0;
  const multi = isPlaylist && count !== 1 && !!href;
  const sub = isPlaylist ? (count > 0 ? (count === 1 ? tr("1 song") : tr("{n} songs", { n: count })) : tr("Empty playlist")) : source.genre && source.genre !== "Mixed" ? source.genre : tr("Song");
  const cover = sourceCover(source);

  const menu = () => {
    const sec = isPlaylist ? playlistSeconds(source.playlist) : source.leafDurationSeconds ?? null;
    const prov = providerLabel(source.type, tr);
    const spec: VmActionSpec = {
      cover,
      title: source.title,
      sub,
      actions: [
        active
          ? { key: "pause", icon: <IconPause />, label: tr("Pause"), run: send.pause }
          : { key: "now", icon: <IconPlay />, label: multi ? tr("Play all") : tr("Play now"), run: () => send.playNow(source) },
        { key: "next", icon: <IconUpNext />, label: tr("Play next"), run: () => send.playNext(source) },
      ],
      details: [
        { label: tr("Type"), value: multi ? tr("Playlist") : tr("Song") },
        ...(count > 1 ? [{ label: tr("Songs"), value: String(count) }] : []),
        ...(sec ? [{ label: tr("Length"), value: fmtTime(sec) }] : []),
        ...(prov ? [{ label: tr("Source"), value: prov }] : []),
        ...(source.genre && source.genre !== "Mixed" ? [{ label: tr("Genre"), value: source.genre }] : []),
      ],
    };
    openActions(spec);
  };

  const body = (
    <>
      <VmCover src={cover} name={source.title} size={52} radius={12} />
      <span className="vm-src-text">
        <span className="vm-src-title vm-bdi" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {active ? <VmEq /> : null}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{source.title}</span>
        </span>
        <span className="vm-src-sub vm-bdi">{sub}</span>
      </span>
    </>
  );

  return (
    <div className="vm-src" data-active={active ? "" : undefined}>
      {multi ? (
        <Link href={href!} className="vm-src-main">
          {body}
          <IconChevronForward className="vm-chev vm-flip" />
        </Link>
      ) : (
        <button type="button" className="vm-src-main" onClick={() => (active ? ui.openNowPlaying() : send.playNow(source))}>
          {body}
        </button>
      )}
      <button type="button" className="vm-more" onClick={menu} aria-label={tr("More")}>
        <IconMore />
      </button>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { useMobileSources } from "@/lib/mobile-sources-context";
import { useMobileFleet } from "@/lib/mobile-fleet";
import { useTr } from "@/lib/i18n/use-tr";
import { getPlaylistTracks, type PlaylistTrack } from "@/lib/playlist-types";
import type { SourceProviderType, UnifiedSource } from "@/lib/source-types";
import { VmPage, VmTarget, useVmUi } from "@/components/vm/vm-ui";
import { VmCover, VmEq, fmtTime } from "@/components/vm/vm-parts";
import { useOpenActions } from "@/components/vm/vm-actions";
import { IconChevronBack, IconLibrary, IconMore, IconPause, IconPlay, IconPlus, IconUpNext } from "@/components/vm/vm-icons";
import { sourceCover, useSendSource } from "@/components/vm/vm-source-row";

/**
 * ONE PLAYLIST — its songs, with "Play all"; a song plays when it is tapped, its ⋯ has play now / play next / details (owner 2026-11-17), sent to the branch that is open.
 * A single song is sent as its own one-URL source whose id carries the playlist id (so "what is playing" lights the right row).
 */
export default function MobilePlaylistPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ""));
  const { sources, status } = useMobileSources();
  const f = useMobileFleet();
  const tr = useTr();
  const ui = useVmUi();
  const send = useSendSource();
  const openActions = useOpenActions();

  const source = useMemo(() => sources.find((s) => s.id === id) ?? null, [sources, id]);
  const playlist = source?.playlist ?? null;
  const tracks: PlaylistTrack[] = useMemo(() => (playlist ? getPlaylistTracks(playlist) : []), [playlist]);

  const shown = f.display.shown;
  const playlistActive = !!source && !!shown && shown.status === "playing" && (shown.currentSource?.id === source.id || shown.currentSource?.id?.startsWith(`${source.id}:`) === true);

  const synth = (t: PlaylistTrack): UnifiedSource => ({
    id: `${playlist!.id}:track:${t.id}`,
    title: t.name,
    genre: source!.genre || "Mixed",
    cover: t.cover || playlist!.thumbnail || source!.cover || null,
    type: t.type as SourceProviderType,
    url: t.url,
    origin: "source",
  });

  const back = (
    <Link href="/mobile/library" className="vm-icobtn vm-back" aria-label={tr("Library")}>
      <IconChevronBack />
      <span>{tr("Library")}</span>
    </Link>
  );

  if (status !== "loading" && !source) {
    return (
      <VmPage title={tr("Playlist")} lead={back}>
        <div className="vm-empty">
          <IconLibrary />
          <h2>{tr("This playlist isn't available")}</h2>
        </div>
      </VmPage>
    );
  }

  return (
    <VmPage title={source?.title ?? ""} lead={back}>
      {source ? (
        <>
          <div className="vm-hero">
            <VmCover src={sourceCover(source)} name={source.title} size={190} radius={20} />
            <div className="vm-hero-sub">{tracks.length === 1 ? tr("1 song") : tr("{n} songs", { n: tracks.length })}</div>
            <div className="vm-hero-btns">
              <button
                type="button"
                className="vm-pill"
                disabled={!tracks.length}
                onClick={() => (playlistActive ? send.pause() : send.playNow(source))}
              >
                {playlistActive ? <IconPause /> : <IconPlay />}
                {playlistActive ? tr("Pause") : tr("Play all")}
              </button>
              <button type="button" className="vm-pill" data-quiet disabled={!tracks.length} onClick={() => send.playNext(source)}>
                <IconPlus />
                {tr("Play next")}
              </button>
            </div>
          </div>
          <VmTarget />
          <div style={{ paddingTop: 6 }}>
            {tracks.map((t, i) => {
              const sid = `${playlist!.id}:track:${t.id}`;
              const active = !!shown && shown.status === "playing" && shown.currentSource?.id === sid;
              const cover = t.cover || playlist!.thumbnail || null;
              const menu = () =>
                openActions({
                  cover,
                  title: t.name,
                  sub: source.title,
                  actions: [
                    active
                      ? { key: "pause", icon: <IconPause />, label: tr("Pause"), run: send.pause }
                      : { key: "now", icon: <IconPlay />, label: tr("Play now"), run: () => send.playNow(synth(t)) },
                    { key: "next", icon: <IconUpNext />, label: tr("Play next"), run: () => send.playNext(synth(t)) },
                  ],
                  details: [
                    { label: tr("Type"), value: tr("Song") },
                    ...(typeof t.durationSeconds === "number" && t.durationSeconds > 0 ? [{ label: tr("Length"), value: fmtTime(t.durationSeconds) }] : []),
                  ],
                });
              return (
                <div key={t.id} className="vm-src" data-active={active ? "" : undefined}>
                  <button type="button" className="vm-src-main" onClick={() => (active ? ui.openNowPlaying() : send.playNow(synth(t)))}>
                    <VmCover src={cover} name={t.name} size={46} radius={11} />
                    <span className="vm-src-text">
                      <span className="vm-src-title vm-bdi" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {active ? <VmEq /> : <span style={{ color: "var(--vm-text3)", fontSize: 13, minWidth: 18 }}>{i + 1}</span>}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
                      </span>
                    </span>
                  </button>
                  <button type="button" className="vm-more" onClick={menu} aria-label={tr("More")}>
                    <IconMore />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="vm-list" style={{ marginTop: 20 }}><div className="vm-skel" /><div className="vm-skel" /></div>
      )}
    </VmPage>
  );
}

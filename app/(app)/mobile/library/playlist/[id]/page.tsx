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
import { VmCover, VmEq } from "@/components/vm/vm-parts";
import { IconChevronBack, IconLibrary, IconPause, IconPlay, IconPlus } from "@/components/vm/vm-icons";
import { sourceCover } from "@/components/vm/vm-source-row";

/**
 * ONE PLAYLIST — its songs, with "Play all" and a play / play-next button per song, sent to the branch that is open.
 * A single song is sent as its own one-URL source whose id carries the playlist id (so "what is playing" lights the right row).
 */
export default function MobilePlaylistPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ""));
  const { sources, status } = useMobileSources();
  const f = useMobileFleet();
  const tr = useTr();
  const ui = useVmUi();

  const source = useMemo(() => sources.find((s) => s.id === id) ?? null, [sources, id]);
  const playlist = source?.playlist ?? null;
  const tracks: PlaylistTrack[] = useMemo(() => (playlist ? getPlaylistTracks(playlist) : []), [playlist]);

  const shown = f.display.shown;
  const playlistActive = !!source && !!shown && shown.status === "playing" && (shown.currentSource?.id === source.id || shown.currentSource?.id?.startsWith(`${source.id}:`) === true);

  const guard = (): boolean => {
    if (!f.selected) { ui.openPicker(); return false; }
    if (!f.canControl) { ui.toast(tr("{name} is offline", { name: f.selected.name })); return false; }
    return true;
  };
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
                onClick={() => {
                  if (!guard()) return;
                  if (playlistActive) f.pause();
                  else { f.playSource(source); ui.toast(tr("Playing on {name}", { name: f.selected!.name })); }
                }}
              >
                {playlistActive ? <IconPause /> : <IconPlay />}
                {playlistActive ? tr("Pause") : tr("Play all")}
              </button>
              <button type="button" className="vm-pill" data-quiet disabled={!tracks.length} onClick={() => { if (guard()) { f.queueNext(source); ui.toast(tr("Will play next on {name}", { name: f.selected!.name })); } }}>
                <IconPlus />
                {tr("Play next")}
              </button>
            </div>
          </div>
          <VmTarget />
          <div style={{ padding: "6px 14px 0" }}>
            {tracks.map((t, i) => {
              const sid = `${playlist!.id}:track:${t.id}`;
              const active = !!shown && shown.status === "playing" && shown.currentSource?.id === sid;
              return (
                <div key={t.id} className="vm-row" data-active={active ? "" : undefined}>
                  <VmCover src={t.cover || playlist!.thumbnail || null} name={t.name} size={46} radius={11} />
                  <div className="vm-row-text">
                    <div className="vm-row-title vm-bdi" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {active ? <VmEq /> : <span style={{ color: "var(--vm-text3)", fontSize: 13, minWidth: 18 }}>{i + 1}</span>}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
                    </div>
                  </div>
                  <button type="button" className="vm-add" aria-label={tr("Play next")} onClick={() => { if (guard()) { f.queueNext(synth(t)); ui.toast(tr("Will play next on {name}", { name: f.selected!.name })); } }}>
                    <IconPlus />
                  </button>
                  <button type="button" className="vm-add" aria-label={tr("Play now")} style={{ background: "var(--vm-text)", color: "#111114" }} onClick={() => { if (!guard()) return; if (active) f.pause(); else { f.playSource(synth(t)); ui.toast(tr("Playing on {name}", { name: f.selected!.name })); } }}>
                    {active ? <IconPause /> : <IconPlay />}
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

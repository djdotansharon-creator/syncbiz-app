"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { useMobileFleet, type FleetBranch } from "@/lib/mobile-fleet";
import { useMobileSources } from "@/lib/mobile-sources-context";
import { buildShelves } from "@/lib/mobile-home";
import { useRecentKeys } from "@/lib/mobile-recent";
import { getPlaylistTracks } from "@/lib/playlist-types";
import type { UnifiedSource } from "@/lib/source-types";
import { useTr } from "@/lib/i18n/use-tr";
import { VmTarget, useVmUi } from "@/components/vm/vm-ui";
import { VmCover, VmEq, branchLine } from "@/components/vm/vm-parts";
import { sourceCover, useSendSource } from "@/components/vm/vm-source-row";
import { useNowTone } from "@/components/vm/vm-tone";
import { IconChevronForward, IconLibrary } from "@/components/vm/vm-icons";

/**
 * HOME (owner 2026-11-20: "a home like Spotify, instead of the library"). Shelves of covers — a picture and its name under it, nothing drawn around it —
 * each one scrolls sideways, "See all" opens the whole list. What a cover does is what a library row does: a song plays on the open branch, a list of
 * several songs opens its songs, the song that plays now opens the player. The colour of what plays now is a soft glow behind the top of the page.
 */

function Shelf({ title, seeAll, wide, children }: { title: string; seeAll?: string; wide?: boolean; children: ReactNode }) {
  const tr = useTr();
  return (
    <section className="vm-shelf" data-wide={wide ? "" : undefined}>
      <div className="vm-shelf-h">
        <h2 className="vm-bdi">{title}</h2>
        {seeAll ? (
          <Link href={seeAll} className="vm-shelf-all">
            {tr("See all")}
            <IconChevronForward className="vm-flip" />
          </Link>
        ) : null}
      </div>
      <div className="vm-shelf-row">{children}</div>
    </section>
  );
}

/** a branch that plays right now: the cover of its song, the song's name, the branch under it — opens the branch */
function LiveCard({ b }: { b: FleetBranch }) {
  const tr = useTr();
  const line = branchLine(b, tr);
  const cover = b.state?.currentTrack?.cover ?? b.state?.currentSource?.cover ?? b.logoUrl;
  return (
    <Link href={`/mobile/branch/${encodeURIComponent(b.id)}`} className="vm-hc" data-active="">
      <VmCover className="vm-hc-art" src={cover} name={line.text} radius={14} />
      <span className="vm-hc-title vm-bdi">
        <VmEq />
        <span>{line.text}</span>
      </span>
      <span className="vm-hc-sub vm-bdi">{b.name}</span>
    </Link>
  );
}

/** a song or a list: tapping does what the library row does */
function SourceCard({ source }: { source: UnifiedSource }) {
  const f = useMobileFleet();
  const tr = useTr();
  const ui = useVmUi();
  const send = useSendSource();
  const shown = f.display.shown;
  const active = !!shown && shown.status === "playing" && (shown.currentSource?.id === source.id || shown.currentSource?.id?.startsWith(`${source.id}:`) === true);
  const isPlaylist = source.origin === "playlist";
  const count = isPlaylist && source.playlist ? getPlaylistTracks(source.playlist).length : 1;
  const multi = isPlaylist && count > 1;
  const sub = isPlaylist ? (count === 1 ? tr("1 song") : tr("{n} songs", { n: count })) : source.genre && source.genre !== "Mixed" ? source.genre : tr("Song");
  const body = (
    <>
      <VmCover className="vm-hc-art" src={sourceCover(source)} name={source.title} radius={14} />
      <span className="vm-hc-title vm-bdi">
        {active ? <VmEq /> : null}
        <span>{source.title}</span>
      </span>
      <span className="vm-hc-sub vm-bdi">{sub}</span>
    </>
  );
  return multi ? (
    <Link href={`/mobile/library/playlist/${encodeURIComponent(source.id)}`} className="vm-hc" data-active={active ? "" : undefined}>
      {body}
    </Link>
  ) : (
    <button type="button" className="vm-hc" data-active={active ? "" : undefined} onClick={() => (active ? ui.openNowPlaying() : send.playNow(source))}>
      {body}
    </button>
  );
}

function ShelfSkeleton() {
  return (
    <section className="vm-shelf" aria-busy>
      <div className="vm-shelf-h"><i className="vm-hc-skel-h" /></div>
      <div className="vm-shelf-row">
        {[0, 1, 2].map((i) => (
          <div className="vm-hc-skel" key={i} style={{ animationDelay: `${-0.3 * i}s` }}>
            <i />
            <b />
            <b />
          </div>
        ))}
      </div>
    </section>
  );
}

export function VmHome() {
  const { sources, status, error, reload } = useMobileSources();
  const f = useMobileFleet();
  const tr = useTr();
  const tone = useNowTone();
  const recentKeys = useRecentKeys();
  const sh = useMemo(() => buildShelves(sources, recentKeys), [sources, recentKeys]);
  const live = useMemo(() => f.branches.filter((b) => b.status === "playing").slice(0, 12), [f.branches]);
  const any = live.length > 0 || sh.recent.length > 0 || sh.mine.length > 0 || sh.ready.length > 0 || sh.songs.length > 0;

  return (
    <>
      <div className="vm-home-glow" style={tone} aria-hidden />
      <VmTarget />
      {live.length ? (
        <Shelf title={tr("Playing in your branches")} seeAll="/mobile/home" wide>
          {live.map((b) => <LiveCard key={b.id} b={b} />)}
        </Shelf>
      ) : null}
      {sh.recent.length ? (
        <Shelf title={tr("Played lately")}>
          {sh.recent.map((s) => <SourceCard key={`${s.origin}:${s.id}`} source={s} />)}
        </Shelf>
      ) : null}
      {sh.mine.length ? (
        <Shelf title={tr("Your playlists")} seeAll="/mobile/library/all?cat=mine">
          {sh.mine.map((s) => <SourceCard key={`${s.origin}:${s.id}`} source={s} />)}
        </Shelf>
      ) : null}
      {sh.ready.length ? (
        <Shelf title={tr("Ready-made lists")} seeAll="/mobile/library/all?cat=ready">
          {sh.ready.map((s) => <SourceCard key={`${s.origin}:${s.id}`} source={s} />)}
        </Shelf>
      ) : null}
      {sh.songs.length ? (
        <Shelf title={tr("Your songs")} seeAll="/mobile/library/all?cat=mine">
          {sh.songs.map((s) => <SourceCard key={`${s.origin}:${s.id}`} source={s} />)}
        </Shelf>
      ) : null}

      {status === "loading" && !any ? (
        <>
          <ShelfSkeleton />
          <ShelfSkeleton />
        </>
      ) : status === "error" && !any ? (
        <div className="vm-empty">
          <h2>{tr("Couldn't load the library")}</h2>
          <span>{error}</span>
          <button type="button" className="vm-pill" onClick={reload}>{tr("Try again")}</button>
        </div>
      ) : status !== "loading" && !any ? (
        <div className="vm-empty">
          <IconLibrary />
          <h2>{tr("Your library is empty")}</h2>
          <span>{tr("Playlists you add on the computer, or find with Search, appear here.")}</span>
        </div>
      ) : null}

      {/* the whole list is always one tap away (also when a shelf is empty) */}
      <Link href="/mobile/library/all" className="vm-home-foot">
        <IconLibrary />
        <span>{tr("Browse the whole library")}</span>
        <IconChevronForward className="vm-chev vm-flip" />
      </Link>
    </>
  );
}

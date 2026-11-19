"use client";

import { useEffect, useMemo, useState } from "react";
import { useMobileFleet } from "@/lib/mobile-fleet";
import { useTr } from "@/lib/i18n/use-tr";
import { IconChevronDown, IconMix, IconNext, IconPause, IconPlay, IconPrev, IconRepeat, IconRepeatOne, IconShuffle, IconVolumeHigh, IconVolumeLow, IconWifiOff } from "@/components/vm/vm-icons";
import { VmCover, VmEq, VmMarquee, VmSlider, fmtTime, useLivePosition } from "@/components/vm/vm-parts";
import { useNowTone } from "@/components/vm/vm-tone";
import { warmTone } from "@/lib/cover-tone";

export type UpNextItem = { id: string; title: string; cover: string | null; tag: string };

/** what comes next on the SELECTED branch: the staged "Play next" songs first, then the rest of the playlist after the current song */
export function useUpNext(): UpNextItem[] {
  const f = useMobileFleet();
  const tr = useTr();
  const shown = f.display.shown;
  return useMemo(() => {
    if (!shown) return [] as UpNextItem[];
    const out: UpNextItem[] = [];
    for (const q of shown.playNextQueue ?? []) out.push({ id: `q:${q.id}`, title: q.title, cover: q.cover, tag: tr("Play next") });
    const tracks = shown.sessionTracks ?? [];
    const i = typeof shown.currentTrackIndex === "number" ? shown.currentTrackIndex : -1;
    if (tracks.length && i >= 0) {
      for (const t of tracks.slice(i + 1, i + 9)) out.push({ id: `t:${t.id}`, title: t.title, cover: t.cover, tag: "" });
    } else if (shown.nextSessionTrack) {
      out.push({ id: "n", title: shown.nextSessionTrack.title, cover: shown.nextSessionTrack.cover, tag: "" });
    }
    return out.slice(0, 10);
  }, [shown, tr]);
}

export function VmUpNextList({ items, playing }: { items: UpNextItem[]; playing: boolean }) {
  const tr = useTr();
  return (
    <div className="vm-upnext">
      <div className="vm-sec">
        {tr("Up next")}
        {playing ? <VmEq /> : null}
      </div>
      {items.map((u) => (
        <div key={u.id} className="vm-row">
          <VmCover src={u.cover} name={u.title} size={46} radius={11} />
          <div className="vm-row-text">
            <div className="vm-row-title vm-bdi">{u.title}</div>
            {u.tag ? <div className="vm-row-sub">{u.tag}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * NOW PLAYING for the SELECTED branch — one component for the full-height sheet (opened from the mini-player) and for a branch's own screen.
 * It only shows what the branch's station reports and sends commands to that station; nothing plays on the phone.
 */
export function VmNowPlaying({ onPickBranch, hideWho }: { onPickBranch?: () => void; /** the branch's own screen already says which branch this is */ hideWho?: boolean }) {
  const f = useMobileFleet();
  const tr = useTr();
  const tone = useNowTone();
  const b = f.selected;
  const shown = f.display.shown;
  const playing = shown?.status === "playing";
  const pos = useLivePosition(shown);
  const dur = shown?.duration && shown.duration > 0 ? shown.duration : 0;

  const trackTitle = shown?.currentTrack?.title || shown?.currentSource?.title || "";
  const cover = shown?.currentTrack?.cover ?? shown?.currentSource?.cover ?? null;
  const listTitle = shown?.sessionTitle || shown?.currentSource?.title || "";
  const subtitle = listTitle && listTitle !== trackTitle ? listTitle : "";

  const upNext = useUpNext();
  const nextSong = upNext[0] ?? null; // owner 2026-11-19: not a list — just the next song
  const nextCover = nextSong?.cover ?? null;
  // the next song's colour is read ahead, so it is ready when that song starts (owner 2026-11-19: the picture changed but the background did not)
  useEffect(() => {
    warmTone(nextCover);
  }, [nextCover]);
  const [volOpen, setVolOpen] = useState(false); // owner 2026-11-19: the volume is not needed open all the time — one press opens it

  if (!b) {
    // the branch list has not been read yet: nothing to say (a "No branch selected" for a moment is a lie)
    if (!f.loaded || !f.known) return <div className="vm-np" aria-busy />;
    return (
      <div className="vm-offline">
        <b>{tr("No branch selected")}</b>
        {tr("Pick a branch to see what it plays and to control it.")}
      </div>
    );
  }

  const can = f.canControl;
  const repeat = shown?.repeatMode ?? "playlist";
  const vol = typeof shown?.volume === "number" ? shown.volume : 80;
  const idle = !shown || shown.status === "idle" || shown.status === "stopped";

  return (
    <div className="vm-np" data-tone="" style={tone}>
      {hideWho ? null : (
        <button type="button" className="vm-np-who" onClick={onPickBranch} disabled={!onPickBranch} aria-label={tr("Choose branch")}>
          <span className="vm-dot" data-s={b.status} />
          <span className="vm-bdi" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
          {onPickBranch ? <IconChevronDown /> : null}
        </button>
      )}

      {!b.online && b.status !== "unknown" && f.known ? (
        <div className="vm-offline" style={{ margin: "26px 0 0" }}>
          <IconWifiOff />
          <b>{b.status === "install" ? tr("No player installed yet") : tr("This branch is offline")}</b>
          {b.status === "install"
            ? tr("Install VONO on the branch computer from the Control Room, and it will show here.")
            : tr("Its player is not connected right now. It will show here as soon as it is back.")}
        </div>
      ) : (
        <>
          <VmCover className="vm-np-art" src={cover} name={trackTitle || b.name} radius={22} playing={playing} quietTile />
          <div className="vm-np-titles">
            {trackTitle ? (
              <>
                <VmMarquee className="vm-np-title" text={trackTitle} />
                {subtitle ? <div className="vm-np-artist vm-bdi">{subtitle}</div> : null}
              </>
            ) : b.status === "unknown" || !f.known || (b.online && !shown) ? (
              // still connecting: nothing is said yet (a "Nothing playing" that turns into the song a moment later is a lie)
              <div className="vm-np-title" aria-busy>
                &nbsp;
              </div>
            ) : (
              <div className="vm-np-title" style={{ color: "var(--vm-text2)" }}>{tr("Nothing playing")}</div>
            )}
            {f.display.label ? <div className="vm-np-status">{tr(f.display.label)}</div> : null}
          </div>

          <div className="vm-np-seek">
            <VmSlider value={pos} max={dur || 1} glide onCommit={(v) => f.seek(v)} label={tr("Position")} disabled={!can || !dur} />
            <div className="vm-times">
              <span>{fmtTime(dur ? pos : null)}</span>
              <span>{dur ? `-${fmtTime(Math.max(0, dur - pos))}` : "–:––"}</span>
            </div>
          </div>

          <div className="vm-transport">
            <button type="button" className="vm-tbtn" onClick={f.prev} disabled={!can || idle} data-busy={f.display.loading ? "" : undefined} aria-label={tr("Previous")}>
              <IconPrev />
            </button>
            <button
              type="button"
              className="vm-tbtn vm-tbtn--play"
              data-busy={f.display.loading ? "" : undefined}
              onClick={() => (playing ? f.pause() : f.play())}
              disabled={!can}
              aria-label={playing ? tr("Pause") : tr("Play")}
            >
              {playing ? <IconPause /> : <IconPlay />}
            </button>
            <button type="button" className="vm-tbtn" onClick={f.next} disabled={!can || idle} data-busy={f.display.loading ? "" : undefined} aria-label={tr("Next")}>
              <IconNext />
            </button>
          </div>

          <div className="vm-modes">
            <button type="button" className="vm-mode" data-on={volOpen ? "" : undefined} onClick={() => setVolOpen((v) => !v)} aria-expanded={volOpen} aria-label={tr("Volume")}>
              {vol <= 0 ? <IconVolumeLow /> : <IconVolumeHigh />}
              <span>{`${Math.round(vol)}%`}</span>
            </button>
            <button type="button" className="vm-mode" data-on={shown?.shuffle ? "" : undefined} onClick={() => f.setShuffle(!shown?.shuffle)} disabled={!can} aria-pressed={!!shown?.shuffle}>
              <IconShuffle />
              <span>{tr("Shuffle")}</span>
            </button>
            <button type="button" className="vm-mode" data-on={shown?.autoMix ? "" : undefined} onClick={() => f.setAutoMix(!shown?.autoMix)} disabled={!can} aria-pressed={!!shown?.autoMix}>
              <IconMix />
              <span>{tr("Auto mix")}</span>
            </button>
            <button
              type="button"
              className="vm-mode"
              data-on={repeat !== "off" ? "" : undefined}
              onClick={() => f.setRepeat(repeat === "playlist" ? "track" : repeat === "track" ? "off" : "playlist")}
              disabled={!can}
              aria-label={tr("Repeat")}
            >
              {repeat === "track" ? <IconRepeatOne /> : <IconRepeat />}
              <span>{repeat === "track" ? tr("Song") : repeat === "off" ? tr("Off") : tr("List")}</span>
            </button>
          </div>

          <div className="vm-volfold" data-open={volOpen ? "" : undefined}>
            <div className="vm-volfold-in" inert={!volOpen}>
              <div className="vm-vol">
                <IconVolumeLow />
                <VmSlider value={vol} max={100} onLive={(v) => f.setVolume(v)} onCommit={(v) => f.setVolume(v)} label={tr("Volume")} disabled={!can} />
                <IconVolumeHigh />
              </div>
            </div>
          </div>

          {nextSong ? (
            <div className="vm-np-next">
              <VmCover src={nextSong.cover} name={nextSong.title} size={40} radius={10} />
              <div className="vm-np-next-text">
                <small>{nextSong.tag || tr("Next")}</small>
                <span className="vm-bdi">{nextSong.title}</span>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

"use client";

import { useMemo } from "react";
import { useMobileFleet } from "@/lib/mobile-fleet";
import { useTr } from "@/lib/i18n/use-tr";
import { IconChevronDown, IconMix, IconNext, IconPause, IconPlay, IconPrev, IconRepeat, IconRepeatOne, IconShuffle, IconVolumeHigh, IconVolumeLow, IconWifiOff } from "@/components/vm/vm-icons";
import { VmCover, VmEq, VmMarquee, VmSlider, fmtTime, useLivePosition } from "@/components/vm/vm-parts";
import { useNowTone } from "@/components/vm/vm-tone";

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

  // what comes next on this branch: the staged "Play next" songs first, then the rest of the playlist after the current song
  const upNext = useMemo(() => {
    if (!shown) return [] as { id: string; title: string; cover: string | null; tag: string }[];
    const out: { id: string; title: string; cover: string | null; tag: string }[] = [];
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

  if (!b) {
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

      {!b.online ? (
        <div className="vm-offline" style={{ margin: "26px 0 0" }}>
          <IconWifiOff />
          <b>{b.status === "install" ? tr("No player installed yet") : tr("This branch is offline")}</b>
          {b.status === "install"
            ? tr("Install VONO on the branch computer from the Control Room, and it will show here.")
            : tr("Its player is not connected right now. It keeps playing by itself, and shows here as soon as it is back.")}
        </div>
      ) : (
        <>
          <VmCover className="vm-np-art" src={cover} name={trackTitle || b.name} radius={22} playing={playing} />
          <div className="vm-np-titles">
            {trackTitle ? (
              <>
                <VmMarquee className="vm-np-title" text={trackTitle} />
                {subtitle ? <div className="vm-np-artist vm-bdi">{subtitle}</div> : null}
              </>
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
            <button type="button" className="vm-tbtn" onClick={f.prev} disabled={!can || idle} aria-label={tr("Previous")}>
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
            <button type="button" className="vm-tbtn" onClick={f.next} disabled={!can || idle} aria-label={tr("Next")}>
              <IconNext />
            </button>
          </div>

          <div className="vm-vol">
            <IconVolumeLow />
            <VmSlider value={vol} max={100} onLive={(v) => f.setVolume(v)} onCommit={(v) => f.setVolume(v)} label={tr("Volume")} disabled={!can} />
            <IconVolumeHigh />
          </div>

          <div className="vm-modes">
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

          {upNext.length ? (
            <div className="vm-upnext">
              <div className="vm-sec">
                {tr("Up next")}
                {playing ? <VmEq /> : null}
              </div>
              {upNext.map((u) => (
                <div key={u.id} className="vm-row">
                  <VmCover src={u.cover} name={u.title} size={46} radius={11} />
                  <div className="vm-row-text">
                    <div className="vm-row-title vm-bdi">{u.title}</div>
                    {u.tag ? <div className="vm-row-sub">{u.tag}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

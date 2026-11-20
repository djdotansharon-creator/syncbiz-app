"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMobileFleet } from "@/lib/mobile-fleet";
import { useTr } from "@/lib/i18n/use-tr";
import { IconChevronDown, IconMix, IconNext, IconPause, IconPlay, IconPrev, IconRepeat, IconShuffle, IconVolumeHigh, IconVolumeLow, IconWifiOff } from "@/components/vm/vm-icons";
import { VmCover, VmEq, VmMarquee, VmSlider, fmtTime, useLivePosition } from "@/components/vm/vm-parts";
import { useNowTone } from "@/components/vm/vm-tone";
import { warmTone } from "@/lib/cover-tone";
import { PLAY_MODES, modeCommands, playModeOf, type PlayMode } from "@/lib/mobile-play-mode";

/** the three play modes, in words: the name on the button and one line that says what it does */
const MODE_TEXT: Record<PlayMode, { label: string; note: string }> = {
  list: { label: "List", note: "In order, and again from the start" },
  mix: { label: "Auto mix", note: "In order, the songs blend into each other" },
  shuffle: { label: "Shuffle", note: "Random order" },
};

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
  // ONE fold under the buttons (owner 2026-11-19: the volume is not needed open all the time — one press opens it; 2026-11-20: the three play modes open in the same place) — the volume bar OR the modes, never both
  const [fold, setFold] = useState<"vol" | "mode" | null>(null);
  // a mode that was just chosen stays on screen until the station says it back (never snaps to the old one and forward again); it lets go after 4 s if the station never does
  const [held, setHeld] = useState<PlayMode | null>(null);
  const heldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // a fold that opens at the bottom of the sheet is brought fully into view once it has unfolded (the sheet scrolls; the choices must never be half off the screen)
  const foldEls = useRef<Record<"vol" | "mode", HTMLDivElement | null>>({ vol: null, mode: null });
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (heldTimer.current) clearTimeout(heldTimer.current);
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    },
    [],
  );
  const toggleFold = (which: "vol" | "mode") => {
    const open = fold !== which;
    setFold(open ? which : null);
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    if (open) scrollTimer.current = setTimeout(() => foldEls.current[which]?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 300);
  };

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
  const mode = held ?? playModeOf(shown);
  const pickMode = (m: PlayMode) => {
    setHeld(m);
    if (heldTimer.current) clearTimeout(heldTimer.current);
    heldTimer.current = setTimeout(() => setHeld(null), 4000);
    for (const c of modeCommands(m, shown?.repeatMode)) {
      if (c.cmd === "shuffle") f.setShuffle(c.value);
      else if (c.cmd === "autoMix") f.setAutoMix(c.value);
      else f.setRepeat(c.value);
    }
  };
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
            <button type="button" className="vm-mode" data-on={fold === "vol" ? "" : undefined} onClick={() => toggleFold("vol")} aria-expanded={fold === "vol"} aria-label={tr("Volume")}>
              {vol <= 0 ? <IconVolumeLow /> : <IconVolumeHigh />}
              <span>{`${Math.round(vol)}%`}</span>
            </button>
            <button type="button" className="vm-mode" data-on={fold === "mode" ? "" : undefined} onClick={() => toggleFold("mode")} aria-expanded={fold === "mode"} aria-label={tr("Play mode")} disabled={!can}>
              {/* the three icons stand on top of each other and cross-fade (no remount, no pop) */}
              <span className="vm-mi" data-m={mode} aria-hidden>
                <IconRepeat />
                <IconMix />
                <IconShuffle />
              </span>
              <span>{tr(MODE_TEXT[mode].label)}</span>
            </button>
          </div>

          <div className="vm-volfold" data-open={fold === "vol" ? "" : undefined} ref={(el) => { foldEls.current.vol = el; }}>
            <div className="vm-volfold-in" inert={fold !== "vol"}>
              <div className="vm-vol">
                <IconVolumeLow />
                <VmSlider value={vol} max={100} onLive={(v) => f.setVolume(v)} onCommit={(v) => f.setVolume(v)} label={tr("Volume")} disabled={!can} />
                <IconVolumeHigh />
              </div>
            </div>
          </div>

          <div className="vm-volfold" data-open={fold === "mode" ? "" : undefined} ref={(el) => { foldEls.current.mode = el; }}>
            <div className="vm-volfold-in" inert={fold !== "mode"}>
              <div className="vm-pick" role="radiogroup" aria-label={tr("Play mode")}>
                {PLAY_MODES.map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={mode === m} className="vm-pick-opt" data-on={mode === m ? "" : undefined} onClick={() => pickMode(m)} disabled={!can}>
                    <span className="vm-mi" data-m={m} aria-hidden>
                      <IconRepeat />
                      <IconMix />
                      <IconShuffle />
                    </span>
                    <span>{tr(MODE_TEXT[m].label)}</span>
                  </button>
                ))}
              </div>
              <p className="vm-pick-note">{tr(MODE_TEXT[mode].note)}</p>
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

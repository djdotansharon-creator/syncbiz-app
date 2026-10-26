/**
 * Gentle pause and play for the display screen (owner 2026-10-25: "when I stop a song don't just cut it — lower it softly, and bring it up softly on play").
 * Pure and testable: the caller hands in the transport's own commands (volume / play / pause) and a sleep. Pause: lower the volume over ~¾ s along a smooth curve, pause,
 * then put the volume back to where it was. Play: start silent, then bring the volume up to where it was. Whatever happens, the volume is put back exactly (`finally`).
 *
 * Fast clicks (owner 2026-10-26: "pressing play and stop twice before the song has started is a bug"): the LAST click wins. A second click while the first is still easing
 * does not wait and is never swallowed — the running one stops at its next step and the new one carries on from the volume the song has RIGHT NOW (no jump, no blip),
 * remembering the owner's real volume from the start of the whole sequence and whether the song was already paused.
 */

export const RAMP_MS = 760;
export const RAMP_STEP_MS = 70;

export type FadeIO = {
  volume: (v: number) => void;
  play: () => void;
  pause: () => void;
  sleep: (ms: number) => Promise<void>;
};

export type Gentle = {
  /** ease towards playing (true) or paused (false); `v0` is the current real volume (only used when no sequence is running) */
  toggle: (toPlay: boolean, v0: number) => Promise<void>;
  /** true while a sequence is under way (also while an older click is being replaced by a newer one) */
  busy: () => boolean;
};

export function createGentle(io: FadeIO): Gentle {
  let token = 0;
  let running = false;
  let level = 0; // the owner's real volume, kept from the start of the sequence
  let sent = 0; // the volume this sequence last set (where the song is right now)
  let paused = false; // is the song paused right now, as far as this sequence knows

  const setVolume = (v: number) => {
    sent = v;
    io.volume(v);
  };

  return {
    busy: () => running,
    async toggle(toPlay, v0) {
      const mine = ++token;
      const stale = () => mine !== token;
      if (!running) {
        level = Math.max(0, Math.round(v0));
        sent = level;
        paused = toPlay; // a click on "play" means it was paused, a click on "pause" means it was playing
        running = true;
      }
      if (level === 0) {
        // already silent — nothing to fade
        running = false;
        paused = !toPlay;
        if (toPlay) io.play();
        else io.pause();
        return;
      }
      // from where the song is NOW to `to`: a full fade takes the full time, a half-way one half of it (the same speed everywhere)
      const ramp = async (to: number): Promise<boolean> => {
        const from = sent;
        const steps = Math.max(2, Math.round((RAMP_MS / RAMP_STEP_MS) * (Math.abs(to - from) / level)));
        for (let i = 1; i <= steps; i++) {
          const x = i / steps;
          const smoothstep = x * x * (3 - 2 * x); // soft at both ends
          setVolume(Math.round(from + (to - from) * smoothstep));
          await io.sleep(RAMP_STEP_MS);
          if (stale()) return false;
        }
        return true;
      };
      try {
        if (toPlay) {
          if (paused) {
            setVolume(0);
            io.play();
            paused = false;
            await io.sleep(160);
            if (stale()) return;
          }
          if (!(await ramp(level))) return;
        } else {
          if (!(await ramp(0))) return;
          io.pause();
          paused = true;
          await io.sleep(120);
          if (stale()) return;
        }
      } finally {
        // the last click's sequence puts the volume back exactly (also if anything went wrong); an older one that was replaced leaves that to its successor
        if (!stale()) {
          running = false;
          setVolume(level);
        }
      }
    },
  };
}

/** one gentle pause / play (no click can interrupt it) */
export async function gentleToggle(toPlay: boolean, v0: number, io: FadeIO): Promise<void> {
  return createGentle(io).toggle(toPlay, v0);
}

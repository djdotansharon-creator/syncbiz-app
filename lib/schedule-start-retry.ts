/**
 * A block's START must really start the music — PURE decision for `components/schedule-auto-player.tsx`.
 *
 * The father 2026-11-18: "scheduling does not always work — sometimes the player does not start, and sometimes it starts and after a break it does not come back to play."
 * PROVEN BY CODE: the engine marked a block "started today" the moment the start was HANDED OVER (on a station the start is a command to MAIN over the cloud socket; in a window the player may not be
 * ready yet) — a start that went nowhere was never repeated, and the player stayed silent until the next block (the start-side twin of the quiet-stop hole fixed on 2026-11-17).
 * Now, a poll after a start, the engine looks at the player: if it is playing (or a person paused it) the start worked; if it is positively SILENT it repeats the start — at most `START_MAX_TRIES` times
 * in all, and only into silence, so it never replaces music that plays (a person's choice, a slow YouTube start that has just begun) and never fights a person for long.
 */

export const START_CHECK_AFTER_MS = 25_000;
export const START_MAX_TRIES = 3;
/** a watch that could not be judged for this long (the player's state never became known) is dropped */
export const START_WATCH_EXPIRES_MS = 5 * 60_000;

/** what the Player reports: null = not known (a station whose status has not arrived yet) */
export type PlayStatus = "playing" | "paused" | "idle" | "stopped" | null;

export type StartWatch = { key: string; at: number; tries: number };

export type StartCheck = "wait" | "ok" | "retry" | "give-up";

export function decideStartCheck(i: { watch: StartWatch; now: number; status: PlayStatus; stillCurrent: boolean }): StartCheck {
  const { watch, now, status, stillCurrent } = i;
  const age = now - watch.at;
  if (!stillCurrent) return "ok"; // another block (or a quiet one) has taken over: this start is not ours to check any more
  if (age < START_CHECK_AFTER_MS) return "wait";
  if (status === null) return age >= START_WATCH_EXPIRES_MS ? "give-up" : "wait";
  if (status === "playing" || status === "paused") return "ok";
  return watch.tries >= START_MAX_TRIES ? "give-up" : "retry";
}

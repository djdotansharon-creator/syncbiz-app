/**
 * A QUIET block's stop must really silence the music — PURE helpers (no React, no I/O) for `components/schedule-auto-player.tsx`.
 *
 * Owner 2026-11-17 (the father's player did not go quiet at a quiet time that used to work). PROVEN BY CODE: on a station playing a URL / YouTube session the scheduled stop is a COMMAND to MAIN
 * (`device.stopOrSend` → `sendCommandToMaster("STOP")` → `ws.send` only while the socket is open, otherwise it returns without a word) and the engine marked the quiet block "done" the
 * moment the command was handed over — so a command lost to a cloud-socket blip was never repeated and the music played on through the quiet time.
 * Now the stop counts as done only when the music has really gone quiet; otherwise it is repeated at the next poll (30 s), at most `QUIET_STOP_MAX_TRIES` times so the engine never fights
 * a person who deliberately starts music during a quiet time.
 */

export const QUIET_STOP_MAX_TRIES = 3;
/** how long after the stop command the engine looks for silence */
export const QUIET_STOP_CHECK_MS = 4000;
const QUIET_STOP_POLL_MS = 250;

/** true as soon as `audible()` is false (within `withinMs`); false when the music is still playing at the end. No signal at all (`audible` throws) = treated as quiet (the old behaviour). */
export async function waitForQuiet(
  audible: () => boolean,
  opts: { withinMs?: number; everyMs?: number; sleep?: (ms: number) => Promise<void>; cancelled?: () => boolean } = {},
): Promise<boolean> {
  const withinMs = opts.withinMs ?? QUIET_STOP_CHECK_MS;
  const everyMs = opts.everyMs ?? QUIET_STOP_POLL_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  try {
    for (let waited = 0; ; waited += everyMs) {
      if (!audible()) return true;
      if (waited >= withinMs || opts.cancelled?.()) return false;
      await sleep(everyMs);
    }
  } catch {
    return true;
  }
}

const tries = new Map<string, number>();

/** counts one more try of this quiet block's stop (renderer memory; a restart starts again, and the first look after a restart reasserts the quiet anyway) */
export function noteQuietStopTry(key: string): number {
  const n = (tries.get(key) ?? 0) + 1;
  tries.set(key, n);
  return n;
}

export function clearQuietStopTries(key: string): void {
  tries.delete(key);
}

/** is this quiet stop finished (marked for today)? Yes when the music is quiet, or when it has been tried enough. */
export function quietStopFinished(confirmedQuiet: boolean, tryNo: number): boolean {
  return confirmedQuiet || tryNo >= QUIET_STOP_MAX_TRIES;
}

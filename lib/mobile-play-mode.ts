/**
 * THE PLAY MODE (owner 2026-11-20: "why can't I choose between List, Auto mix and Shuffle? make it one button that opens the three options, in the volume bar's place").
 * The player keeps three separate switches (shuffle, auto mix, loop). The phone offers ONE choice of three:
 *   List     — in order, and again from the start        (shuffle off · auto mix off · loop the list)
 *   Auto mix — in order, the songs blend into each other (auto mix on · shuffle off)
 *   Shuffle  — random order                              (shuffle on · auto mix off)
 * Pure: what the station reports → the mode on screen; a chosen mode → the commands that go out. Every command is an ABSOLUTE value (the same one twice does no harm),
 * and the new mode is switched ON before the old one is switched OFF — there is never a moment with no mode.
 * "Loop one song" / "no loop" are not on the phone any more (a store plays on); choosing List puts the loop back to "the list".
 */
export type PlayMode = "list" | "mix" | "shuffle";
export type RepeatMode = "playlist" | "track" | "off";

export const PLAY_MODES: readonly PlayMode[] = ["list", "mix", "shuffle"];

/** what the station reports → the mode shown (the computer can have shuffle AND auto mix on together: shuffle is shown, it is the stronger change) */
export function playModeOf(s: { shuffle?: boolean; autoMix?: boolean } | null | undefined): PlayMode {
  return s?.shuffle ? "shuffle" : s?.autoMix ? "mix" : "list";
}

export type ModeCommand = { cmd: "shuffle"; value: boolean } | { cmd: "autoMix"; value: boolean } | { cmd: "repeat"; value: RepeatMode };

/** the commands one choice sends, in the order they go out */
export function modeCommands(mode: PlayMode, repeat: RepeatMode | undefined): ModeCommand[] {
  switch (mode) {
    case "mix":
      return [{ cmd: "autoMix", value: true }, { cmd: "shuffle", value: false }];
    case "shuffle":
      return [{ cmd: "shuffle", value: true }, { cmd: "autoMix", value: false }];
    default:
      // List: nothing special is on; a loop that was set to "one song" / "off" on the computer goes back to "the list"
      return [{ cmd: "shuffle", value: false }, { cmd: "autoMix", value: false }, ...(repeat === "track" || repeat === "off" ? [{ cmd: "repeat", value: "playlist" } as const] : [])];
  }
}

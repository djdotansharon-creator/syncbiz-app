/**
 * Client-side remote command IDs, dedupe, and pending tracking for CONTROL → MASTER.
 */

import type { RemoteCommand } from "./types";

export type CommandOutcome = "pending" | "ack" | "success" | "failed" | "timeout";

export type TrackedRemoteCommand = {
  commandId: string;
  command: RemoteCommand;
  sentAt: number;
  outcome: CommandOutcome;
  ackAt?: number;
  finishedAt?: number;
  error?: string;
  masterDeviceId?: string;
  /** PLAY_SOURCE dedupe key (source id + playlist + track index). */
  dedupeKey?: string;
};

export const REMOTE_COMMAND_TIMEOUT_MS = 8_000;
export const TRANSPORT_DEBOUNCE_MS = 120;

let commandSeq = 0;

export function nextCommandId(): string {
  commandSeq += 1;
  return `cmd-${Date.now()}-${commandSeq}`;
}

export function playSourceDedupeKey(
  sourceId: string,
  playlistId: string | undefined,
  trackIndex: number,
): string {
  return `play:${sourceId}|${playlistId ?? ""}|${trackIndex}`;
}

export function isTransportCommand(command: RemoteCommand): boolean {
  return command === "NEXT" || command === "PREV" || command === "PLAY" || command === "PAUSE" || command === "STOP";
}

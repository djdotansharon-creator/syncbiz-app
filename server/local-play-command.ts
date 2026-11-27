/**
 * `PLAY_LOCAL_SOURCE` shape guard for the WS server (owner 2026-11-26: a Remote may start a LOCAL playlist on the station).
 *
 * The command carries IDS ONLY: `{ sourceId, trackIndex }` and nothing else - never a path, a url, a title or a track list (CLAUDE.md section 12:
 * local filesystem paths are LOCAL ONLY). The server forwards it to the room's MASTER unchanged, but ONLY when it has exactly this shape: an
 * extra field (a smuggled url / path), a non-plain id or a bad row number is refused BEFORE any routing.
 *
 * Kept standalone (the server builds with its own root); identical in rule to `lib/remote-local-play.ts` and `desktop/src/shared/local-play-command.ts`
 * (`scripts/verify-remote-local-play.ts` keeps the three in step).
 */

export const LOCAL_PLAY_COMMAND = "PLAY_LOCAL_SOURCE";

const SAFE_ID = /^[A-Za-z0-9_:.-]{1,200}$/;
const MAX_TRACK_INDEX = 100_000;

export function isLocalPlayPayload(p: unknown): p is { sourceId: string; trackIndex: number } {
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  const keys = Object.keys(p as Record<string, unknown>);
  if (keys.length !== 2 || !keys.includes("sourceId") || !keys.includes("trackIndex")) return false;
  const o = p as { sourceId?: unknown; trackIndex?: unknown };
  return (
    typeof o.sourceId === "string" &&
    SAFE_ID.test(o.sourceId) &&
    !o.sourceId.startsWith("local:") &&
    !o.sourceId.startsWith("file:") &&
    typeof o.trackIndex === "number" &&
    Number.isInteger(o.trackIndex) &&
    o.trackIndex >= 0 &&
    o.trackIndex <= MAX_TRACK_INDEX
  );
}

/** true when a COMMAND must be refused: it is `PLAY_LOCAL_SOURCE` and its payload is not exactly `{ sourceId, trackIndex }` */
export function localPlayCommandMalformed(command: string, payload: unknown): boolean {
  return command === LOCAL_PLAY_COMMAND && !isLocalPlayPayload(payload);
}

/**
 * In-process station state mirror for WS `STATE_UPDATE` (titles, position sync from MPV).
 * Local audio execution is in `MpvManager` + `PlaybackOrchestrator` — this module does not decode audio.
 */
export { MockPlaybackSession } from "./mock-playback-session";

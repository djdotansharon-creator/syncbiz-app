/**
 * P0 Drop Next (2026-10-08) — the LOCAL engine's AUTOMATIC advance can yield its next slot to MAIN's Play Next queue.
 *
 * On the designated station the renderer's LOCAL engine may only play LOCAL files (lib/device-mode-guard.ts), so a
 * dropped URL / playlist is queued and played by desktop MAIN. While MAIN holds queued items and watches the LOCAL
 * track now playing, the LOCAL engine must NOT advance by itself at its mix point / natural end: MAIN prepares and
 * mixes the queued item in, and when the queue is empty the renderer takes the slot back and resumes LOCAL exactly
 * where it stopped. Set by DevicePlayerProvider; read by PlaybackProvider.next() for automatic advances only.
 */
export const autoAdvanceHandoff: { current: null | (() => boolean) } = { current: null };

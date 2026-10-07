# P0 URL CONTINUITY + OWNERSHIP — RUNTIME ACCEPTANCE (2026-10-07)

> Status: **ACCEPTED 2026-10-07 — TEST only.** Lenovo runtime **owner-attested**, with Lenovo `main.log` evidence
> supplied by the owner (this Dev-PC session did not read the Lenovo logs directly). Renderer deployment and file
> hashes are **server-verified**. **PROD untouched.**
> Branch `feature/control-room-phase1` (pushed). Class: **RENDERER ONLY** (no installer; Desktop baseline stays
> `2.2.8-beta.12`). After this lock, no playback change without a new isolated gate.

## 1. Accepted commits

| Commit | Content |
|---|---|
| `8e8895a` | URL session natural-EOF auto-advance on the designated station |
| `d61731471cc9a8a52965c417a0a3898495b721e8` (`d617314`) | URL ownership — stale LOCAL AUTOMIX can never take over a MAIN URL session |

TEST app deployment **`3f258faf-d90b-4f5d-8bbf-d2246e7aec8b`** (both commits, clean tree). Server-verified:
`components/audio-player.tsx`, `lib/playback-ownership.ts`, `lib/device-player-context.tsx`, `lib/url-eof-advance.ts`
hash-identical to `d617314`. WS (`23e94c01`), desktop MAIN, watchdog, tokens, DB unchanged.

## 2. Root causes and fixes

### A. URL EOF left the station silent (`8e8895a`) — PROVEN BY CODE
- A designated-station URL playlist session is played by MAIN via WS PLAY_SOURCE under a **MAIN-minted attempt id**
  (≥ 1,000,000,001, since `2e5b4b8`). The renderer's only natural-end handler (`components/audio-player.tsx`) acts on
  **its own** attempts while its provider is playing — never true for a MAIN URL session — and MAIN holds only session
  metadata (no URLs). `MPV_ENDFILE reason=eof` therefore led nowhere: idle forever (incidents r7 / r8 at ~14 min).
- Fix: pure tracker `lib/url-eof-advance.ts` + wiring in `lib/device-player-context.tsx`. The co-located renderer that
  committed the URL session arms on the CURRENT MAIN attempt's real decode and, on that attempt's playing → idle with
  no error and the engine up, steps the SAME session forward **once** through the existing `stepUrlSession` →
  PLAY_SOURCE N+1 path (`noWrap`: last item = unchanged end-of-session, no invented loop). Explicit STOP, ERROR / QUIT
  / process exit, stale / superseded / outgoing-crossfade attempts and renderer-owned (LOCAL) attempts never advance;
  every step and every new URL selection disarms (one EOF ⇒ at most one step).

### B. Stale LOCAL AUTOMIX stole a URL session (`d617314`) — PROVEN BY CODE + reproduced in test
- Incident 11:49:00.520Z: ~11 s before URL r0's EOF the renderer issued `PLAY_REQUEST sourceType:"local-file"
  crossfade:true` → `XFADE_BEGIN source:"local"` → `MPV_LOADFILE kind:"file"`; URL `MPV_ENDFILE eof` (attempt
  1000000001) at 11:49:11.772Z came after LOCAL had taken over.
- Cause: the desktop near-end AUTOMIX scheduler reads MAIN's live MPV snapshot but never checked whose attempt it was.
  A URL selection only relinquishes LOCAL **session** ownership (`device-player-context`) — the provider keeps status
  "playing" with its LOCAL track / queue, and the per-attempt re-arm reset the latch for the URL attempt. At the URL's
  mix point the scheduler called provider `next()` → next LOCAL item → LOCAL crossfade. (The natural-end, load-error and
  freeze self-heal paths already require `attemptId === playbackAttemptGen`; the scheduler was the only autonomous
  path without it. Not a stale timer.)
- Fix: one guard in the scheduler — act only when the snapshot is the renderer's OWN current attempt
  (`lib/playback-ownership.ts`). LOCAL loads always carry the renderer's generation, so LOCAL-only AUTOMIX, manual LOCAL
  NEXT and an explicit URL → LOCAL switch are unchanged.

## 3. Lenovo runtime evidence (owner-attested; main.log values supplied by the owner)

- A LOCAL queue existed in the background.
- URL attempt **1000000001** played; no LOCAL takeover during the URL session.
- `MPV_ENDFILE reason:"eof" attemptId:1000000001`, then **283 ms later** `MPV_LOADFILE attemptId:1000000002 kind:"url"`.
- Result: URL ownership PASS · URL EOF → next URL PASS · LOCAL takeover BLOCKED · next source = URL · duplicate load NONE.
- Earlier owner test (8e8895a alone): saved YouTube album auto-advanced URL → URL at natural EOF with no manual NEXT.
- Server-log corroborated (TEST WS, since the EOF deploy): every MAIN REGISTER `permanent designation -> MASTER
  (trusted station)` and every embedded-renderer REGISTER `CONTROL`, canonical room `ws:31d30e23…:90d2b7b8…`; 0 × 409;
  only 5xx = pre-existing `music-bank/authorize` 503.

## 4. Tests (Dev-PC)

`verify-p0-url-eof-advance` 22/22 · `verify-p0-url-owner-automix` 15/15 (incl. root-cause reproduction with the guard
off) · `verify-p0-local-url-queue-split` 31/31 · desktop: crossfade readiness 27/27, attempt-mode 24/24, automix
re-arm 9/9, local-playback-prb 47/47, P0 watchdog/URL 25/25, watchdog self-check 68/0 · app/server suites 23/25 (2
environment-gated scripts fail identically on HEAD) · desktop suites 20/20 · tsc + `next build` PASS.

## 5. Rollback

Tag `pilot-baseline/2026-10-07-renderer-d617314` → `d617314`. Previous renderer baseline: tag
`pilot-baseline/2026-10-07-renderer-3d6a70d` (P0 hardening) / F2a `398cce7` (same renderer behaviour as `3d6a70d`).
Renderer-only: redeploy the previous source to the TEST app; no installer / DB / WS rollback involved.

## 6. Still PARKED (separate gates — not fixed here)

- Premature long-URL EOF (~2 h YouTube URLs ending with `eof` at ~14 min) — cause unknown (baseline §9 item 21).
- Startup source restore / Settings coherence — startup always resumes LOCAL; a renderer reload / Settings navigation
  can start stale LOCAL while MAIN reports URL (baseline §9 item 22).
- Startup queue hydration (baseline §9 item 7).
- External controller ownership release (baseline §9 item 17) and the other §9 items.

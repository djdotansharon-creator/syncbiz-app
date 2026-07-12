# SyncBiz — Project State (Claude working map)

> Read this FIRST instead of scanning files. Update it after every meaningful change.
> Last updated: 2026-07-12.

## What this app is
Business media player: Next.js 16 app (`app/`, `components/`, `lib/`) + standalone WS server (`server/`, port 3001) + Electron desktop player (`desktop/`, MPV). DB = PostgreSQL/Prisma. Auth cookie `syncbiz-session`. Main workspace route: `/sources` (rendered by `SourcesManager` via `app/(app)/(workspace)/layout.tsx`; the page itself is empty).

## Design language (2026-07 redesign — "clean Apple/Mac")
- Tokens in `app/globals.css` `:root`: `--sb-bg #0a0a0c`, surfaces `white/4–7%`, borders `white/8–14%`, text `#f5f5f7 / #a1a1a6 / #6e6e73`, accent **#0a84ff** (soft tint for active), on-air green #30d158, danger #ff453a.
- NO neon/glow/text-shadow/pulse. Primary play = **solid white circle, dark glyph**. Buttons: quiet surface or bare icon with circle-on-hover. Active toggle = blue tint. Global smooth press (`button:active { scale: .97 }`) + 150ms color transitions (in globals near `body`).
- Nav rails: plain grey text rows → white when active/hover, tiny stroke icons (`LibraryNavGlyph` in sources-manager).

## Key files & anchors (search by SYMBOL, not line numbers)
- **`components/sources-manager.tsx` (~3.9k lines — NEVER read whole)**
  - `LibrarySelection` type + `visibleSources` memo (search `selection.id === "playlists"`), view ids incl. `user_playlists`, `scheduled_playlists`.
  - LIBRARY nav render: search `navViewActive` (data-driven rows + `LibraryNavGlyph`). DJ AI button = center module toggle `dj-creator-hub`.
  - Schedules: `playlistSchedules` state + `refreshPlaylistSchedules` (GET /api/schedules, PLAYLIST targets), `playlistScheduleLineById`, `openPlaylistScheduleWindow` (opens ScheduleBlockModal; existing schedule → edit via `scheduleId`), `playlistIdForCollectionKey` (direct / daypart / title match).
  - Collection grid cards (Scheduled/Ready center views): search `openCollectionGridTrash`.
  - Grid uses `LIBRARY_CARD_GRID_CLASS` = `library-source-card-grid`.
- **`components/source-card-unified.tsx`** — grid card. `resolveCardPlatform`/`PlatformLogoBadge` (logo top-right, no shadow), `DesktopGetAppBadge` (local playlists in browser; `desktopOnlyTrackCount` = mixed “N on Desktop”), `onSchedulePress`/`scheduleLine` props, actions via `LibrarySourceItemActions`, `playlistAiMenuSlot` = ⋯ menu.
- **`components/player-surface/player-deck-transport-surface.tsx`** — deck transport: stop · prev · white play · next · **dice ShuffleToggleButton** · **LoopToggleButton** (playlist→track→off; blue, "1" badge for track) · **AutoMixToggleButton** split pill (toggle | mix-length picker 3/6/9/12s).
- **`lib/mix-preferences.ts`** — localStorage stores + change events: mix duration, automix, shuffle, **RepeatMode** (`getRepeatMode` etc., default "playlist"). UI reads via `useSyncExternalStore` (lint forbids setState-in-effect).
- **`lib/playback-provider.tsx` (~2.3k lines — NEVER read whole)**
  - `computeSessionNextTrackIndex(count, idx, shuffle, repeatMode, rand)` — loop logic; exhausted+`ended_auto` → status stopped. `next()` computes `effectiveRepeatMode` (manual next: track→playlist).
  - `getNextStreamUrl`/`getNextEmbeddedSource` — early `return null` when repeat mode "track" (no automix target).
  - `runPlay` unplayable-track fallback scans FORWARD from requested idx (local:// skip fix).
- **`components/audio-player.tsx` (~4.4k lines — NEVER read whole)**
  - `YT_MANUAL_DECK_CROSSFADE_ENABLED = true` (near YT_PRELOAD consts). Manual switch = A/B deck crossfade; mix point = `dur − getMixDuration()` (search `mixPointThreshold`).
  - 500ms poll (search `truthAuditPollTickRef`) reads active deck via `getYtActivePlayer` (`ytActiveDeckRef`).
  - Timeline = classic thin bars (waveform strip REVERTED; component `player-surface/waveform-seek-strip.tsx` exists unused, accepts real `peaks`).
- **`components/live-queue-panel.tsx`** — deck queue; `displayedSessionTracks` rotates so the PLAYING row renders first (display-only, originalIndex preserved).
- **`components/dj-creator-hub-panel.tsx`** — DJ AI playlists panel (clean language; list rows; white Play pill / ghost Open).
- **`components/playlist-ai-shell-menu.tsx`** — the ⋯ menu (line ~102 dropdown is `absolute` INSIDE the card → gets clipped by card overflow-hidden. KNOWN BUG, fix = portal/fixed).
- **`components/app-shell.tsx` (~1.7k — NEVER read whole)** — header: clock chip · MASTER/STANDALONE (`HeaderDeviceIndicators`; duplication fixed) · agents chip · avatar · fullscreen · gear · **desktop download at far right**. Media routes lock page scroll (`lg:h-screen lg:overflow-hidden` chain down to sources-manager grid; inner panes scroll).
- **Search**: `components/library-input-area.tsx` — ONE unified input (ffda5dd) living inside the command rail in sources-manager (between Favorites and Guest; search `library-sources-input-shell`). `looksLikeIngestText` routes links (YouTube/Spotify/radio/local path) to ingest on Enter/paste; text goes to search. Results dropdown Spotify-style: catalog FIRST with "Top result" big card + Songs list (search `Top result`), then library/My Music/radio/YouTube; shared consts `RESULT_ROW/THUMB/TITLE/META/PLAY_BTN/GHOST_BTN` + `ResultPlatformLogo`; no letter chips. `lib/search-service.ts` merges `/api/catalog/smart-search` (keywords/genres/moods, rows w/ artist·duration·views) with plain title search.
- **Card CSS**: end of `app/globals.css` — blocks: "Full-bleed library cards" (fog overlay, bare icons circle-on-hover), "List rows — same language", "Song grid — frameless rounded rectangles" (16:9, 4-per-row lg+, stats strip `library-card-meta-footer` quiet single line, genre hidden in grid).

## How to verify (saves tokens — do this, not guessing)
- Dev server usually already running on :3000 (user's or my background task). Check: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login`.
- Playwright login: `test@syncbiz.com` / `test123` (fill `#email`,`#password`, wait `/api/auth/login` response). **Always launch chromium with `--autoplay-policy=no-user-gesture-required`** — without it YT playback "bugs" are FALSE POSITIVES (deck crossfade freeze incident).
- Test account has 2 YT singles + small playlists + 18 DJ-AI e2e playlists. No local files.
- `npx tsc --noEmit` (root covers app only). ESLint: pre-existing errors in sources-manager/app-shell — only check touched files; rule `react-hooks/set-state-in-effect` is enforced.

## State / recent history (newest first)
- DJ hub restyled clean; platform logo shadowless; stats strip restored on grid fog. (aa39d3a)
- Grid = frameless 16:9 rounded rectangles, 4/row, fog carries title+icons+stats. (16f143c)
- Dice=Random glyph; LIBRARY nav icons. (31688f8)
- LOOP 3-state + repeat-mode plumbing; queue playing-row-first; shuffle std glyph. (d4e741a)
- AUTOMIX split pill w/ mix-length picker; forward-skip fix. (0f465bb)
- Deck crossfade re-enabled — headless freeze was autoplay-policy false positive. (6923bb3; memory note)
- Waveform strip reverted from deck (stability request). Transport redesign kept. 
- Fixed layout (`lg`+): page never scrolls; search bar fixed; only cards pane scrolls.
- LIBRARY nav: counts on all rows; Scheduled = real scheduled playlists view (`scheduled_playlists`) with header + "+ New Schedule"; clock on every playlist card (edits existing schedule); blue schedule line on cards.
- Backups: branch `backup/pre-redesign-2026-07-09` = original design (fd66216). Every step committed on main.

## Workspace rails contract (9d0428b — SYMMETRIC 3 columns 240/260/280)
LEFT rail: LIBRARY nav (icons+counts; "Your Playlists" row has inline "+" create — sibling-button layout, search `Add playlist`) → collapsed "Scheduled & Ready Playlists" shelf (row 2).
RIGHT rail (col-start-3, row-span-2, own scroll): DJ Creator AI card (clean sparkles tile, no gold) → YOUR PLAYLISTS compact list (cover·name·count·trash, slice(0,30), max-h-[60vh]).
CENTER (col-start-2, row-span-2): command rail (view toggles · genres · LIBRARY · Favorites · unified search · Shazam · Guest · Link) → scrolling cards pane.

## Search/ingest behavior contract (75d328b)
- Catalog rows must be RELEVANT (query words in title/artist/tags) or they don't render — the user's rule: "if it's not in the catalog, show what I searched first". Discover (YouTube) renders above Radio.
- Every ingest jumps selection to `recently_added` (handleAdd) — new items always visible first. SHAZAM pill next to Guest = placeholder for phone-app→desktop capture (future), currently opens Recently Added.
- Spotify albums/playlists 401/403 → blocked-flow (user-token retry → connect/paste CTA), never raw HTTP errors.

## Open items / known issues
1. ~~⋯ menu clipped~~ DONE (c91f224): playlist-ai-shell-menu is a controlled button + document.body portal (fixed pos from trigger rect). Verify on real account.
2. ~~DJ hub grid/list~~ DONE (c91f224): `view` state persisted `syncbiz-djhub-view`; grid reuses `library-source-card-grid` + sb-lbc classes.
3. ~~List parity~~ DONE (c91f224): internal `SourceRow` (in sources-manager, search `function SourceRow(`) takes `onSchedulePress`/`scheduleLine`/`playlistAiMenuSlot`; list callsite builds `rowAiMenuSlot`.
4. Natural-end automix uses same deck engine — watch for handoff issues (memory note).
5. Phase-2 sweep: ~30 files still contain old glow classes (radio page, schedules, mobile, modals).
6. Real waveform peaks (server-side ffprobe → catalog) — designed, not built; strip component ready.

## User preferences (product voice)
Hebrew speaker; wants international/Mac-clean look ("not AI-made"), zero playback risk (business player must never stop), nothing deleted — relocate into panels/menus; verify in real browser before claiming done; hates token-wasting full-file scans — keep this file current instead.

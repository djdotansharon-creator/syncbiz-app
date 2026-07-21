# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **READ `docs/PROJECT-STATE.md` FIRST** — the living working map (design language, key symbols per file, verification recipe, open items). Keep it updated after every meaningful change. Do NOT scan the large files (sources-manager, audio-player, playback-provider, app-shell) — use the anchors listed there.

## ⭐ NON-NEGOTIABLE: Player & Controller quality bar

SyncBiz is heading to market as an **international, top-tier product**. The player and
controller are the product. A business customer whose music **freezes**, **stalls**, or
whose player feels **slow/laggy** will simply walk away — this is an existential bug class,
not a polish item. Every change must uphold this bar:

1. **The music must NEVER stop.** When something goes wrong (a stalled stream, a lost lease,
   a dead engine, a missing URL), the system must **self-heal / fail forward** (retry, re-dispatch,
   skip to keep audio alive) — never sit silent. Prefer recovery over an error state; never
   introduce a code path that can leave the player stuck.
2. **Fast & responsive.** Transport actions (play/pause/next/seek) must feel instant. Never add
   blocking work, long awaits, or heavy re-renders to the playback hot path.
3. **Rock-solid stability.** The playback chain (`components/audio-player.tsx`,
   `lib/device-player-context.tsx`, `lib/playback-provider.tsx`) gets **surgical, additive edits
   only**, each verified before commit. When a fix can't be reproduced locally (e.g. desktop MPV),
   ship a **read-only diagnostic first**, capture the real failure, then fix precisely — never
   guess-edit the playback chain.
4. **Every step must be excellent.** Hold this bar for anything touching playback, sync, or the
   controller mirror — correctness, resilience, and perceived speed come before features.

## Commands

### Development
```bash
npm run dev:all        # Start Next.js (:3000) + WebSocket server (:3001) concurrently
npm run dev            # Next.js only
npm run dev:ws         # WebSocket server only (cd server && npm run dev)
```

### Build & Lint
```bash
npm run build          # Next.js production build
npm run lint           # ESLint
```

### Desktop (Electron)
```bash
npm run desktop:shell  # Build Next.js, stage for Electron, launch Electron app
```

### Tests
```bash
npx playwright test                        # E2E tests (runs against production URL by default)
BASE_URL=http://localhost:3000 npx playwright test  # Run against local dev server
```

---

## Architecture

### What This Is
SyncBiz is a media control and scheduling platform for business environments. It does **not** store media — it manages playback control, scheduling metadata, and device coordination. Devices (speakers, screens) are controlled remotely via WebSocket commands.

### Process Architecture
Two separate Node.js processes must run together:

1. **Next.js app** (`app/`, `lib/`, `components/`) — UI + REST API routes
2. **WebSocket server** (`server/`) — Real-time device registry and command routing

The WS server is a standalone Node process (`server/index.ts`) built separately with its own `package.json` and `tsconfig.json`. It is **not** part of the Next.js build.

There is also an **Electron desktop wrapper** (`desktop/`) with its own build pipeline — it bundles the Next.js standalone output for offline/local deployment.

### Data Flow
```
UI (React/Next.js)
  → /api/player/commands, /api/play-now  (HTTP)
  → lib/store.ts  (PostgreSQL via Prisma — no JSON files)
  → server/index.ts  (WebSocket message dispatch)
  → Device client  (browser tab, Electron, or remote agent)
```

### Center Monitor (UI principle — owner directive)
The central pane below the player is the system's **monitor**: it swaps "channels" by what the operator clicks. The Library grid, Jingles console, DJ Creator hub, My Music, and the Guests/WhatsApp inbox all render in the **same center slot** — never as floating drawers/popups over the player. Add a new full-surface feature by adding a `CenterModule` id (`lib/center-module-context.tsx`) + a `*WorkspacePanel({ onClose })` (root `sb-anim-rise … max-h-[min(85vh,760px)]`) wired into the `sources-manager.tsx` center ternary, plus a launcher that calls `setActiveCenterModule(<id>)`. See `docs/PROJECT-STATE.md` → "CENTER MONITOR principle".

### Key Patterns

**Store (lib/store.ts)**  
Reads/writes persistent state via **PostgreSQL (Prisma)**. JSON files under `data/` are stale orphans — no longer read or written by any store. All stores (`store.ts`, `user-store.ts`, `playlist-store.ts`, `radio-store.ts`, `catalog-store.ts`) use `lib/prisma.ts` directly.

**WebSocket Device Registry (server/index.ts)**  
Devices register with a `REGISTER` message. A per-branch **MASTER lease** controls which device is active; only one device per branch can hold the lease at a time. The lease has a 90-second grace period for failover and is persisted to `server/data/master-lease.json`. Heartbeat: ping every 30s, disconnect at 90s timeout.

**Session Auth (middleware.ts)**  
Cookie `syncbiz-session` stores the user's email. Protected routes redirect to `/login`. Mobile user-agents redirect to `/mobile`.

**Playback Contexts (lib/)**  
- `PlaybackProvider` (`lib/playback-provider.tsx`) — global queue and playback state for the controller UI  
- `DevicePlayerContext` (`lib/device-player-context.tsx`) — per-device playback state on the receiver side  
- `LibraryPlaybackContext` — ties library browsing to the active queue

**Data Persistence Paths (lib/data-path.ts)**  
On Railway: `/app/data/` (persistent volume). Locally: `./data/`, `./playlists/`, `./catalog/`, `./radio/`. Falls back to legacy paths if the new volume layout isn't present.

**YouTube/yt-dlp (lib/yt-dlp-search.ts)**  
Search and metadata are resolved server-side via the `yt-dlp` CLI. Pinned as `serverExternalPackages` in `next.config.ts` so it never ends up in client bundles. ffprobe is also used for audio metadata.

### TypeScript Scope
`tsconfig.json` at the root covers only the Next.js app — `server/` and `desktop/` are excluded and have their own `tsconfig.json` files. The path alias `@/*` maps to the project root.

### Environment Variables
```
NEXT_PUBLIC_WS_URL=ws://localhost:3001    # Client-side WebSocket endpoint
SYNCBIZ_WS_SECRET=<min 16 chars>         # Shared secret for WS token verification
RAILWAY_VOLUME_MOUNT_PATH=/app/data      # (Railway only) persistent volume mount path
```

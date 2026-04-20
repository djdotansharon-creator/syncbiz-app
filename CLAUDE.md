# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

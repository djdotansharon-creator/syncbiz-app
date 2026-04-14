# Railway Deployment – Persistent Data and WS

## Why data appears empty after deploy

SyncBiz now reads persistent data from:

- `playlists`
- `catalog`
- `radio`
- `data` (users/schedules/deleted-sources)

When `RAILWAY_VOLUME_MOUNT_PATH` is set, runtime expects these under:

- `<mount>/playlists`
- `<mount>/catalog`
- `<mount>/radio`
- `<mount>` (for `users.json`, `schedules.json`, etc.)

If Railway mount/env does not match this layout, app can boot with an empty library.

## Required Railway setup

### 1) Next app service

- Add Volume to the Next service
- Mount Path: `/app/data`
- Railway auto-sets `RAILWAY_VOLUME_MOUNT_PATH=/app/data`

### 2) WS server service

- Add Volume to the WS service (can be same logical disk or dedicated)
- Mount Path: `/app/data`
- WS lease persistence is stored at:
  - `/app/data/ws-lease/master-lease.json`

## Runtime paths (current code)

- playlists: `${RAILWAY_VOLUME_MOUNT_PATH}/playlists`
- catalog: `${RAILWAY_VOLUME_MOUNT_PATH}/catalog`
- radio: `${RAILWAY_VOLUME_MOUNT_PATH}/radio`
- data: `${RAILWAY_VOLUME_MOUNT_PATH}` (`users.json`, `schedules.json`, `deleted-sources.json`)
- ws lease: `${RAILWAY_VOLUME_MOUNT_PATH}/ws-lease/master-lease.json`

Migration safety:
- If volume subdirs are missing but legacy local dirs exist (`./playlists`, `./catalog`, `./radio`), runtime reads legacy dirs instead of returning empty lists.

## Required env vars

Next service:

- `NEXT_PUBLIC_WS_URL=wss://<your-ws-service-domain>`
- `WS_SERVER_HTTP_URL=https://<your-ws-service-domain>`
- `SYNCBIZ_WS_SECRET=<same secret as WS service>`

WS service:

- `SYNCBIZ_WS_SECRET=<same secret as Next service>`
- `MASTER_GRACE_MS=90000` (or your preferred value)

## Start commands

Next service:

- Build: `npm run build`
- Start: `npm run start`
- Port: `3000`

WS service (repo root, not `/server` image build):

- Build: `npm --prefix server run build`
- Start: `npm --prefix server run start`
- Port: `3001`

## Permissions fallback (only if write errors)

If Railway reports permission-denied on mounted volume:

`RAILWAY_RUN_UID=0`

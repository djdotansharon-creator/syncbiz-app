# Playlist sharing — design (owner decisions 2026-11-22)

Status: **DESIGN + DORMANT DB FOUNDATION (migration file in a branch, not applied anywhere, not merged).** Nothing reads or writes the new columns/table yet.

## Product decisions (Ori + Dotan, in chat)
1. **Sharing is inside VONO, not a link.** Today's share icon only makes a link to the *original source URL* (YouTube …). Sharing means: to **my branches** (a list, or "all") and to a **person with a VONO account**, even in another business (DJs / content people sharing music edits with businesses).
2. **LIVE.** Whoever receives a playlist sees every change the owner makes (read-only). The receiver can **"make my copy"** under their own name — then it is independent.
3. **The receiver must approve.** A request card (the playlist's square cover, its name under it, the creator, the number of songs). "Peek inside" = the card glides to the corner and the numbered list opens (the same screen as an opened playlist, read-only). Then: **Accept** (live) / **Make my copy** / **Decline**.
4. **A person's VONO ID: `name#1234`** (4 digits). Found by the EXACT ID only — no browsing/partial search. Also the easy way to add people to a business besides the QR / join code.
5. **Creator credit:** "created by **name**" in small text under the playlist's name. Older playlists show none (nobody recorded the creator).
6. **Local files never travel.** A local song inside a shared playlist shows grey on the other side ("local file not found"; can be removed); a fully-local playlist from another branch is shown only if it was shared.
7. v1 targets: my branches, or a person. Not "a business" as a target (it has many people — who approves?).

## Database foundation (additive — migration `20261122120000_playlist_sharing_foundation`)
- `User.handle String? @unique` — the VONO ID, lowercase `name#1234`; null until assigned.
- `Playlist.createdByUserId String?` → `User` (`ON DELETE SET NULL`), indexed.
- enums `PlaylistShareTargetKind (BRANCH, USER)`, `PlaylistShareStatus (PENDING, ACCEPTED, DECLINED, REVOKED)`.
- table `PlaylistShare (id, playlistId, fromUserId, targetKind, targetBranchId?, targetUserId?, status, createdAt, decidedAt?, revokedAt?)` with indexes on playlist, sender, (target user, status), (target branch, status); FKs cascade on delete of the playlist / users.
- Only `ADD COLUMN`, `CREATE TYPE/TABLE/INDEX`, `ADD FOREIGN KEY`. No `DROP`, no `ALTER COLUMN`, no data change. Checked: the whole migration chain applies on an empty database and the resulting database equals the schema (empty `prisma migrate diff`).
- **ORDER MATTERS — Railway does NOT run migrations** (build = `next build`, start = `next start`), and the Prisma client SELECTs every column of the schema. So: **(1) migrate the PROD database FIRST** (this migration is additive and nullable, so the OLD code keeps working with it), **(2) only then merge / deploy.** Deploying first would break every Playlist and User read on PROD. Touching the PROD database needs the owner's explicit word, a backup first, and row counts before/after (see the pre-merge checklist, item 4).
- While dormant there is no reason to do either now: do the PROD migration + merge together, right before phase B ships.

## The security-critical part (phase D)
Playlists are tenant-walled (`playlistTenantMatches`, `gatePlaylistAccess`). A live share across businesses is a deliberate, narrow **read-only** window through that wall: the receiver cannot edit, cannot see anything else of the owner, the owner can revoke at any moment, and when the owner deletes the playlist the receiver sees "no longer available" (copies stay). It needs its own audit before any code.

## Phases (each its own PR; nothing merged without the owner's word)
- **A** (this) — additive DB foundation + pure ID helpers (`lib/user-handle.ts`). Dormant.
- **B** — assign IDs (+ show "your VONO ID" with copy) and the creator credit under the playlist name (stamp `createdByUserId` on new playlists).
- **C** — share to **my branches** inside one business: notification, the request/preview card, accept / copy / decline; the library by branch (+ shared-in).
- **D** — share to a **person** across businesses: live read-only + copy (security audit first).
- **E** — grey local songs.

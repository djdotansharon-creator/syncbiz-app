# Session summary — cloud session 2026-10-21 → 2026-10-25 (for the next chat)

Previous chat (read-only reference): https://claude.ai/code/session_0165VpqQzwpLzThas8NwXoFt
Owner: Dotan (product owner, not a programmer). Reply in Hebrew, simple words. Always clarify the goal with
AskUserQuestion, give an honest professional opinion. Follow `CLAUDE.md` (constitution) and
`docs/VONO_PILOT_BASELINE.md` §1 STATUS (current truth). No secrets in files or chat.

## Machines / environments
- **Lenovo** `dsk-cbeb93d0-…` = pilot reference, VONO desktop, **TEST** (`syncbiz-pr52-test`), designated MASTER.
  Do NOT touch it.
- **Dev-PC** `dsk-9b11bfa1-…` = Dotan's development computer. Until now: browser on **PROD**
  (`focused-exploration`: services `syncbiz-app` + `syncbiz-ws`; main auto-deploys PROD).
- Dotan has TWO PROD accounts: `djdotansharon@gmail.com` and `vonoservice@gmail.com` — each is its own workspace.
- Local repo on the Dev-PC: `D:\APP Project\syncbiz-app`.

## Merged to main in this period (main HEAD `ed98d59`)
- #57 radio Israeli stations / delete / station wall, softer login limit (10 fails / 5 min), Shufersal allow-list
  (`NEXT_PUBLIC_SHUFERSAL_BANK_WORKSPACES`, fail-closed) · #59 radio ICY now-playing · #61 Ori's server additions ·
  #60 Ori's redesign → reverted by #62 (Windows GPU flicker); Ori's design kept on his branches.
- **#63** browser tab identity: one live tab = one deviceId (Web Lock claim, `lib/device-id.ts`) + WS server 10 s web
  reload window (`WEB_RELOAD_RECLAIM_MS`). **ACCEPTED IN PROD — owner-attested 2026-10-24.**
- **#64** F4: a scheduled jingle fires once per branch (branch-scoped Web Lock scheduler, per-branch storage —
  `default` keeps the old key —, delivery survives a scheduler tab dying, needs `isBranchConnected`). Merged
  2026-10-24 (`ed98d59`), renderer only. **PROD smoke test by Dotan still PENDING.**

## Open work — nothing started, each needs owner approval (one defect per PR)
1. **Dev-PC as a PROD desktop station** (owner chose this; Lenovo stays TEST): follow
   `docs/handoff/2026-10-25-devpc-prod-station.md` (needs a session ON the Dev-PC: installer build, Railway, PROD DB
   read-only; STOP points inside).
2. Audit 2026-10-25 findings (details in the baseline §1 "AUDIT 2026-10-25"):
   - **F6** promoted browser MASTER stays silent (adoption effect never runs; browser-only rooms) — P0 for
     browser-only customers, not for designated stations.
   - **Stale CONTROL display** — CONTROL keeps showing a dead MASTER's "playing" (indefinitely if nobody is
     promoted, e.g. Lenovo offline) — P1 for the pilot; first check it on Lenovo/TEST.
   - **F9** browser MASTER: pad with pre-roll bell → bell cut, jingle over the music (candidate fix: one
     PLAY_INTERRUPT `{url, preRoll, bellStyle}`).
   Recommended order: Lenovo/TEST stale-display check → F6 → stale display → F9.
3. Parked: F2, F3, F8, J16 residual, command ACK / idempotency (future P0), Shufersal PROD variables, Israeli
   stations need `countryCode` IL on `/owner`, SSRF on `/api/radio/metadata`, Windows GPU-light pass before Ori's
   design returns, remove the scroll-collapse player.

## Working branch
`claude/great-planck-2k7lps` (= main + docs commits: handoff files + baseline audit). A merged PR's branch is
restarted from main for new work.

# Phone app — "the flow" redesign: how to go back

> **Kept as a prototype (2026-11-18):** the owner's father liked the new interface less, so "the flow" is saved as a **design prototype** that can be brought back at any time — without reverting anything on `main` and without losing the work done since. It is the git tag `phone-prototype/flow-2026-11-18` (on GitHub, immutable, → `1827aaa`, the state of `main` right after the flow was merged) and the kept branch `son/phone-flow-2026-11-18`. To look at it or to restore only its look later: `git checkout phone-prototype/flow-2026-11-18 -- components/vm app/mobile-app.css 'app/(app)/mobile'` on a new branch (then re-apply the day-board switch from the schedule round below if it is still wanted). Never delete or move the tag.

The phone app's branch screen and person page were redesigned on 2026-11-18 as an experiment ("the flow": whole pages like the iPhone Control Center, a day board, frameless rows, details behind an arrow). It is **RENDERER ONLY** — no database, server, desktop or migration change — so going back is a plain code revert and needs no data step.

## Known-good reference (what the phone app was before the flow)

| What | Value |
|---|---|
| Git tag (on GitHub) | `phone-baseline/2026-11-18-before-flow-a5d077e` |
| `main` at that point | `a5d077e` (PR #205: phone branch hub + people management) |
| PROD (Railway) deployment at that point | `6e5d1174-d497-4e30-b77a-92db21a6ba39` (SUCCESS) |
| The flow's own code | branch `son/phone-flow-2026-11-18` (kept; it is not deleted after the merge) |

The tag is immutable history: never delete or move it.

## Going back (recommended — a revert PR, no force push, nothing lost)

```bash
git fetch origin
git checkout -b son/phone-flow-revert origin/main
# the flow was merged as ONE merge commit: find it and revert the merge (mainline 1 = main's side)
git log --merges --oneline -5 | head
git revert -m 1 <the flow's merge commit>
git push -u origin son/phone-flow-revert
gh pr create --base main --title "Revert the phone flow" --body "Back to the pre-flow phone app (tag phone-baseline/2026-11-18-before-flow-a5d077e)."
```

Merge that PR (Railway deploys `main` by itself). Check: `git diff phone-baseline/2026-11-18-before-flow-a5d077e origin/main -- components/vm app/mobile-app.css 'app/(app)/mobile'` should show nothing but work done after the flow.

To bring the flow back later, revert the revert (or merge `son/phone-flow-2026-11-18` again).

## Going back fast (emergency)

Railway keeps recent deployments: the deployment above can be redeployed from the Railway dashboard (Deployments → the old one → Redeploy). That is temporary — the next push to `main` deploys `main` again — so follow it with the revert PR above.

## What the flow touched (for a partial revert)

- `components/vm/vm-flow.tsx`, `vm-day-board.tsx`, `lib/day-board.ts`, `lib/use-branch-details.ts` (new)
- `components/vm/vm-ui.tsx` (VmPage `flow` / `tone`), `vm-now-playing.tsx` (`useUpNext`, `hideUpNext`), `vm-parts.tsx` (`neutral` disc), `vm-tone.ts` (`deep`), `vm-schedule-switch.tsx` (`title`), `vm-icons.tsx`
- `app/mobile-app.css` (the font stacks and the "THE FLOW" block)
- `app/(app)/mobile/branch/[id]/page.tsx`, `app/(app)/mobile/people/[userId]/page.tsx`
- `lib/i18n/phrases.ts` (Hebrew), `scripts/verify-mobile-flow.ts`, `scripts/verify-mobile-app.ts`

The people-management screens (PR #205) and the older schedule page (`/mobile/scheduling`) were not changed by the flow.

## Schedule engine round (2026-11-18, the father's four notes) — RENDERER + SERVER (additive), no database migration

What changed (all in one PR on top of the flow): (1) a block's **start is watched** and repeated into silence if the player did not start (`lib/schedule-start-retry.ts`); (2) a scheduled **stop fades out over 9 s** through the Player's own volume path (`lib/schedule-fade.ts`); (3) one block can be **switched off for one day** (`Schedule.skipDates`, stored in the block's existing `taxonomyTags` column as `skip-date` tags — `lib/schedule-skip.ts`; Studio card switch "Plays on <date>", phone day board: press a block); (4) music a person chose in the middle of a block **plays on until the next block** — the phone app (`/mobile`) runs no schedule of its own, and a control-room browser window opened inside a block adopts it instead of playing over the music (`decideScheduleAction` `watch`).

Going back: `git revert -m 1 <the merge commit of this round>` (a revert PR, no force push). No data step is needed: the only stored thing is `skip-date` tags inside `taxonomyTags` — an older app ignores them, and they can stay. The PROD database is untouched (no migration).

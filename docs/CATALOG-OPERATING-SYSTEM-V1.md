# Catalog Operating System — V1 (admin / editor guide)

**Stage 11 — finalization.** This doc closes the **Catalog Operating System V1** loop: one place an admin or editor can read to understand how the four newest pieces fit together end-to-end.

> No scoring changes, no DB writes, no migrations were introduced by V1. Everything described below is **read-only diagnostic** layered over data that already exists in `CatalogItem`, `CatalogItemTaxonomyTag`, and the `CatalogCoverageTargetsBundle`. DJ Creator selection and Coverage strict matching **do not** consume the readiness or eligibility helpers yet — they are surfaced for operators today, with consumption deferred to a later milestone.

Related: `docs/CATALOG-DJ-CREATOR-ROADMAP.md` (stage table + future work), `docs/MUSIC-TAXONOMY-STAGE3.md`, `docs/ENERGY-INTELLIGENCE-STAGE-6-2.md`, `docs/CATALOG-SOURCE-METADATA-FUTURE.md`.

---

## 1. What V1 ships

| # | Capability | Surface | Helper / data |
|---|------------|---------|---------------|
| 7 | **Music Programming Coverage** — pack-level health report | `/admin/platform/catalog-coverage` | `lib/recommendations/catalog-coverage-health.ts` + `catalog-coverage-targets.json` |
| 8 | **Coverage → Tagging workflow** — deep links carry pack context into the editor | Coverage dashboard candidate list → Catalog tagging editor | `coverageWorkbenchContext` query params; `components/admin/catalog-tagging-scroll-to-editor.tsx` |
| 9 | **Item Readiness / quality gate** — per-item ready / partial / needs-work | Catalog tagging row pill + editor panel | `lib/recommendations/catalog-item-readiness.ts` |
| 10 | **Item Eligibility diagnostics** — translates readiness into DJ Creator / Coverage strict flow flags | Catalog tagging row pill + editor panel + Coverage candidate row pill | `lib/recommendations/catalog-item-eligibility.ts` |

V1 deliberately stays in the diagnostic layer. Editors see verdicts; the runtime keeps using the existing rules and rule bundles.

---

## 2. Mental model — what a "ready" catalog item is

A `CatalogItem` is **ready** when it has, **all of**:

- ≥1 `MAIN_SOUND_GENRE` taxonomy link
- ≥1 `STYLE_TAGS` taxonomy link
- ≥1 `BUSINESS_FIT` **or** `PLAYBACK_CONTEXT` taxonomy link
- ≥1 `DAYPART_FIT` taxonomy link
- `manualEnergyRating` set to an integer in `[1, 10]`
- A recognized URL type (`youtube`, `spotify`, `soundcloud`, `local`, `stream-url`, `winamp`)
- `durationSec > 0` **or** a known `provider` (so source metadata indicates type)
- *(Soft)* a thumbnail — missing thumbnail is a **warning**, not a hard fail

| Hard-fail count | Status      | Eligibility tier   |
|-----------------|-------------|--------------------|
| 0               | `ready`     | `fully-eligible`   |
| 1–2             | `partial`   | `limited`          |
| 3+              | `needs-work`| `blocked`          |

Two **overrides** force `needs-work` regardless of count:

- Unknown URL type ⇒ excluded from **Coverage strict matching**
- `manualEnergyRating` unset **and** no duration **and** no provider ⇒ `needs-work`

Per-flow eligibility, derived from readiness:

| Flag                          | True when                                              |
|-------------------------------|--------------------------------------------------------|
| `djCreatorStrictEligible`     | `status === "ready"` **and** energy is set in `[1, 10]` |
| `djCreatorAnyEligible`        | `status !== "needs-work"`                              |
| `coverageStrictMatchEligible` | URL type is recognized                                 |
| `adminVisible`                | always true                                            |

---

## 3. Daily editor loop

The intended end-to-end workflow:

1. **Open the Coverage Dashboard** at `/admin/platform/catalog-coverage`.
   - Scan pack health pills (`healthy` / `weak` / `critical`). Pick the weakest pack with the largest target gap.
   - In the **Close candidates (tag next)** list, ignore items pre-flagged `BLOCKED` (URL type unknown / energy + metadata missing) — they are not worth tagging until the underlying data is fixed. Prefer `LIMITED` and unflagged candidates.
2. **Click "Open in tagging"** on a candidate.
   - The deep link carries the pack id, label, missing pack tag dimensions, energy hint, and URL type/shape into the tagging editor (Stage 8).
3. **Read the editor banners** in this order:
   - **Programming coverage banner** (teal) — shows which pack you came from and which dimensions the *pack* needs. Clicking a chip jumps the dictionary tab.
   - **Readiness panel** — global per-item verdict with `Missing · X` chips. Updates live as you save links.
   - **Eligibility panel** — per-flow `✓/✗` flags (DJ Creator strict, DJ Creator loose, Coverage strict, Admin/search). Reasons explain each `✗`.
4. **Fix in priority order** (cheapest gain first):
   - `Missing · URL type` — usually a provider / `videoId` issue; check the source row and re-canonicalize before tagging.
   - `Missing · Energy` — set manual energy 1–10 in the editor's Energy panel.
   - `Missing · Genre / Style / Fit-Context / Daypart` — pick from the dictionary tab the banner jumps to. The pack's missing dimensions narrow the choice.
   - `Warning · Thumbnail` — try a metadata refresh (Stage 5.9 snapshot) but do not block on it.
5. **Save** in the editor. The readiness / eligibility panels recompute from saved links.
6. **Return to coverage** via the back link in the editor banner; the next candidate is one click away.

A row is "done" when its readiness pill shows **READY** *and* the eligibility panel shows ✓ on the flows you care about.

---

## 4. UI surfaces map

```
/admin/platform/catalog-coverage                Pack health  +  Close-candidate list
                                                   │              │ (pill: LIMITED / BLOCKED)
                                                   │              ▼
                                                   │       Open in tagging  (deep link with pack context)
                                                   ▼              │
                                          Pack action hints       ▼
                                                          /admin/platform/catalog-tagging?catalogItemId=…
                                                                  │
                                                                  ├── Programming coverage banner (Stage 8)
                                                                  ├── Readiness panel             (Stage 9)
                                                                  └── Eligibility panel           (Stage 10)
                                                                            │
                                                                            └── ← Coverage dashboard (back link)
```

Row-list pills (`READY` / `PARTIAL` / `NEEDS WORK`, plus `LIMITED` / `BLOCKED` when applicable) are visible on every list row at `/admin/platform/catalog-tagging` — useful for triage without opening the editor.

---

## 5. Glossary

- **Readiness** (Stage 9) — *Is this row well-formed enough to be used?* Global, item-level, independent of any pack.
- **Eligibility** (Stage 10) — *Which downstream flows can use it?* Derived from readiness; per-flow boolean flags.
- **Coverage health** (Stage 7) — *How well does the catalog cover a programming pack?* Aggregate, pack-level, never collapsed into a single score.
- **Coverage workbench context** (Stage 8) — *Which pack sent me here?* Per-link query param payload that primes the editor.
- **Coverage strict matching** — A future runtime mode (not implemented in V1) that would only consider items whose URL type is recognized.
- **DJ Creator strict** — A future runtime mode that would only pull items whose readiness is `ready` and energy is set.

---

## 6. Common gaps & cheapest fix

| Symptom                                   | First thing to check                                          |
|-------------------------------------------|---------------------------------------------------------------|
| Eligibility says `Coverage (strict) ✗`    | URL type — fix `provider` / re-canonicalize the source URL    |
| Eligibility says `DJ Creator (strict) ✗`  | `manualEnergyRating` (set 1–10) **or** finish missing tag dims |
| Readiness `NEEDS WORK` despite many tags  | Likely `Missing · URL type` — that override forces needs-work |
| Pack stays `weak` though many items added | Look at `strictAllDeclaredDimensionsCount` — items must satisfy *every* non-empty pack dimension, not just one |
| Thumbnail warning                          | Trigger a metadata refresh via the editor's snapshot panel    |

---

## 7. What's diagnostic-only vs enforcing

- ✅ Diagnostic-only in V1: readiness, eligibility, coverage strict-eligibility flag, all UI pills/panels, all reasons text.
- ❌ Not enforced in V1: DJ Creator selection, coverage matching, smart-search ranking, scoring weights — these still run on prior rules and the rule bundle.
- ❌ Not changed in V1: any DB schema, any Prisma migration, any write API, any auto-tagging.

This boundary is intentional: the helpers are read-only, side-effect-free, and safe to wire into runtime later without backfill.

---

## 8. Future work (carried into the next milestone)

- **Wire eligibility into runtime** — DJ Creator strict packs and Coverage strict matching consume `assessCatalogItemEligibility`. Behind a feature flag for one release; verify against admin-tagged sample sets.
- **Bulk readiness report / CLI** — generate a JSONL or CSV of `READY / PARTIAL / NEEDS WORK` counts per provider, per workspace, per pack. Pairs with `npm run catalog-coverage:work-queue`.
- **Auto-suggested fixes** — propose specific dictionary slugs for each `Missing · X` based on `metadataSuggestions` already loaded by the editor. Still no auto-apply.
- **Energy band coverage** — once Stage 6.2 lands, extend readiness to require manual energy *within the pack target band* for `djCreatorStrictEligible`.
- **Per-row archive intent** — tie eligibility `blocked` items to the existing `archivedAt` UX so editors can soft-remove rows that cannot be repaired (e.g. dead URLs). This is enforcement, so explicitly out of V1.
- **DJ Creator wizard preflight** — use eligibility on the wizard's "preview pool" screen to show how many candidates are `LIMITED` before commit.

These are tracked in `docs/CATALOG-DJ-CREATOR-ROADMAP.md` under the Stages 7–11 cluster.

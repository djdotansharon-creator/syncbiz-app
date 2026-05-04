# SyncBiz Catalog / DJ Creator / Smart Catalog — 11-stage roadmap

**Purpose:** Single place to track the catalog intelligence product line. This doc is the **official roadmap** for stages that are **confirmed in code or existing docs**; rows marked **inferred / proposed** are not yet canonically numbered in the repo.

**Related:** `docs/ENERGY-INTELLIGENCE-STAGE-6-2.md`, `docs/CATALOG-INTELLIGENCE-FORWARD-RULES.md`, `docs/CATALOG-SOURCE-METADATA-FUTURE.md`, `docs/MUSIC-TAXONOMY-STAGE3.md`.

---

## 1. Eleven-stage summary table

| # | Stage | Name | Status | What exists in repo | What remains |
|---|-------|------|--------|---------------------|--------------|
| 1 | **0** | Admin CRM shell | **Done** | Placeholder landing; minimal chrome in `app/admin/layout.tsx`; `requireSuperAdmin` chain. | Richer CRM nav/product polish beyond catalog scope. |
| 2 | **1** | Workspace business profile | **Done** | `WorkspaceBusinessProfile` helpers + form on workspace admin; Stage 1 called out on platform workspace drill-down. | Extend profile fields only if product asks (out of catalog core). |
| 3 | **2** | Auth, users, playlist publication scope | **Done** | Multi-user types, passwords, auth helpers, admin users API; `Playlist.publicationScope` + playlist types docs. | Ongoing ops validation; unrelated to closing Stage 6. |
| 4 | **3** | Music taxonomy dictionary | **Done** | Prisma taxonomy model, seed runner, Playlist Pro merges, Stage 3 import flow in `docs/MUSIC-TAXONOMY-STAGE3.md`; admin taxonomy page. | Dictionary maintenance (content), not a stage gate for 6. |
| 5 | **4** | SUPER_ADMIN manual catalog tagging | **Done** | Global `CatalogItem` ↔ `MusicTaxonomyTag` links; provenance enum; catalog tagging platform surface. | Continued curation volume; no structural blocker for Stage 6. |
| 6 | **5** | Catalog workbench (browse, filters, review, metadata) | **Done** / **Needs validation** | Browse-first workbench, review queue, deterministic suggestions (5.5–5.8), coverage diagnostics (5.3–5.4), fit/vibe scoring inputs (5.1–5.2), append-only source snapshots (5.9), metadata-derived hints. | Edge-case QA after recent workbench pushes; spot-check filters/save/skip flows. |
| 7 | **6** | Catalog intelligence — Smart Catalog + DJ Creator V1 | **In progress** | `parse-smart-catalog-query`, `smart-catalog-search`, `/api/catalog/smart-search`, admin smart-search preview page; DJ Creator rules bundle + `dj-creator-ai-shell` + coverage tier; manual energy 1–10 + derived BPM **display** (6.2A) in workbench; archive/restore APIs + usage tier in top dashboard. | **See § Definition of Done (Stage 6)** below. |
| 8 | **6.2** | Full Energy Intelligence (taxonomy + scoring) | **Not started** | Planning only: `docs/ENERGY-INTELLIGENCE-STAGE-6-2.md`. Code comments separate **display-only** bands from future scoring. | Product approval; schema + scoring work **after** DJ Creator V1 stabilization (per energy doc). |
| 9 | **8** | Active workspace (session scope) | **Done** | HttpOnly active-workspace cookie; `WorkspaceSwitcher`; POST `/api/auth/active-workspace`. | None for catalog roadmap. |
| 10 | **7** *(inferred / proposed)* | Catalog source extended metadata | **Not started** | Deferred spec: `docs/CATALOG-SOURCE-METADATA-FUTURE.md` (views/likes/provenance, etc.). | Schedule after Stage 1/2 stabilization per that doc; implement without breaking 5.9 append-only rules. |
| 11 | **9** *(inferred / proposed)* | Catalog-first player search | **Not started** | Intent in `docs/CATALOG-INTELLIGENCE-FORWARD-RULES.md` (internal catalog before external providers; protected library input unit). | Dedicated milestone; coordinate with player/library rules; **do not** change `components/library-input-area.tsx` without explicit request. |

**Note on numbering:** Stages **7** and **9** in this table use **placeholder stage numbers** for two documented future milestones. The repo does not label them as “Stage 7” or “Stage 9” in code comments—only as future/deferred docs. Rename or renumber when the team locks a master plan.

**Affinity branches & Catalog Programming (cross-cutting):**

- **Catalog Programming** — `MusicTaxonomyCategory.CATALOG_PROGRAMMING` and workbench editor tab exist; editorial tags need **seed/content** and any product rules you want tied to DJ / search later.
- **Affinity branches** — `lib/recommendations/music-affinity-branches.types.ts` + JSON bundle: **data-only scaffold**; file states they are **not** wired to scoring or DJ Creator. **Later:** product wiring + optional seed/ops process.

### Music Programming Coverage (not “genre coverage” alone)

**Music Programming Coverage** is how well the catalog satisfies a *programming intent*: a stack of separate axes, never a single blended “genre score.”

Keep these dimensions **distinct in data, rules, and explanations** (they may co-appear in UI or packs, but must not be collapsed into one bucket):

- **Genres** (dictionary genre / family semantics)
- **Style tags** (fine-grained style / sonic vocabulary)
- **Business-fit tags** (venue, audience, use-case fit vs workspace profile)
- **Daypart tags** (time-of-day programming)
- **Energy** (contextual intensity; BPM is related but not interchangeable — see Stage 6.2 doc)
- **URL type** (source shape: stream, file identity, provider class — overlaps extended source metadata when modeled)
- **Editorial signals** (curation, programming category, human labels)

A **coverage pack** is a **bundle** that applies *together* for a scenario (e.g. wizard step + smart search context): it **combines** dimensions for evaluation and UX, but **does not merge** them into one lossy axis. Reporting, scoring hints, and curation should remain able to say *which* dimension is thin.

*Note:* In conversations, “Stage 7” sometimes names **programming coverage** work. In *this* roadmap table, row **Stage 7** is still the separate placeholder for **catalog source extended metadata** (`docs/CATALOG-SOURCE-METADATA-FUTURE.md`). Do not treat “extended stats” as a substitute for the orthogonal coverage model above.

---

## 2–6. Stage detail (compact)

For each numbered stage, the table above is the source of truth: **stage number**, **name**, **status**, **what exists**, **what remains**.

---

## 7. Current position

**Stage 6 — V1 validation.**  
Implementation of Smart Catalog Search and DJ Creator V1 is in the tree; the gating work is **stabilization and validation** (especially E2E/browser), not new feature scope. Full **Stage 6.2** energy/BPM in scoring is **explicitly out of scope** until V1 is accepted.

---

## 8. Definition of Done — closing Stage 6 (V1)

Treat Stage 6 as closed when **all** of the following are true:

1. **DJ Creator V1** — Wizard + rules bundle + smart-search integration behave consistently in manual QA (primary flows: venue/daypart/vibe → results → save draft where enabled).
2. **E2E / browser validation** — Playwright coverage for DJ Creator contextual flows (e.g. `e2e/dj-creator-gym-context.spec.ts`) is **green** against the agreed `BASE_URL` (local or staging), or failures are triaged with documented waivers.
3. **Smart Catalog API** — `/api/catalog/smart-search` and admin preview align on parser output and scoring explanations for the same inputs (no silent drift without a tracked reason).
4. **6.2 scope boundary** — Team agrees **not** to ship full taxonomy energy fields or BPM-in-scoring as part of “Stage 6 closed”; those stay under **Stage 6.2** planning until approved.
5. **Workbench + archive** — Archive/restore and usage display remain correct for representative items after recent workbench changes (smoke only; no new Prisma work required for this doc).

Affinity branches and Catalog Programming **do not** block Stage 6 closure if they remain **scaffold/data-only**; track **seed + wiring** under a later milestone.

---

## 9. Next safest action

1. Run DJ Creator / Smart Catalog E2E against running app:  
   `BASE_URL=http://localhost:3000 npx playwright test e2e/dj-creator-gym-context.spec.ts`  
2. Fix **test or product** discrepancies until green, or record explicit product decisions where tests should change.  
3. **Do not** start Stage 6.2 migrations or scoring changes until Stage 6 V1 sign-off above.

---

## Changelog

- **Music Programming Coverage** — documented orthogonal dimensions (genre, style, business-fit, daypart, energy, URL type, editorial) and **coverage pack** rule (combine, do not merge); clarified informal “Stage 7” vs roadmap Stage 7 placeholder.
- **Roadmap authored** in-repo as `docs/CATALOG-DJ-CREATOR-ROADMAP.md` to replace ad-hoc stage references scattered across comments.

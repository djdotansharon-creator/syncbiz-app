# Stage 6.2 — Energy Intelligence (planning only)

**Status:** Not implemented. Do not use this doc as a spec for runtime behavior until Stage 6.2 is approved and built.

## Model split (product rule)

- **Energy (0–10)** — Business / user **feeling** and context (wizard, venue, daypart). **BPM does not replace energy.**
- **BPM** — **Technical tempo metadata** for future filtering, soft scoring, and explanations. It supports energy but is not the same dimension.

## Numeric energy → suggested BPM bands (planned)

BPM ranges **may overlap** across adjacent energy levels. These are **defaults / hints**, not strict buckets.

| Energy | Suggested BPM (planning) |
|--------|---------------------------|
| 0 | No beat / ambient / spoken / jingle / intro |
| 1 | 60–90 |
| 2 | 80–100 |
| 3 | 90–110 |
| 4 | 100–115 |
| 5 | 110–122 |
| 6 | 120–126 |
| 7 | 124–130 |
| 8 | 128–136 |
| 9 | 135–145 |
| 10 | 145+ / peak / extreme energy |

## Planned behavior (Stage 6.2)

- **CatalogItem BPM override** (when present) **beats** taxonomy-level BPM defaults — same precedence idea as manual energy min/max/default vs taxonomy.
- **If exact BPM is unknown** at item level: estimate from **taxonomy / style / daypart** (and related signals) before falling back to neutral treatment.
- **Scoring:** BPM should usually act as a **soft** signal (fit / ordering), **not** a hard exclude — unless a future product rule explicitly adds guardrails.
- **Energy fields** (planned elsewhere): nullable `energyLevelMin` / `energyLevelMax` / `energyLevelDefault` on `MusicTaxonomyTag` and `CatalogItem`; catalog overrides win over taxonomy for **energy**; parallel idea for **BPM** when overrides exist.

## Gating

- **No** Prisma migrations, UI, smart-search scoring changes, desktop/server/playback/mobile work until Stage 6.2 is explicitly approved and scheduled **after** DJ Creator V1 stabilization.
- **Do not change current scoring** until explicitly approved.

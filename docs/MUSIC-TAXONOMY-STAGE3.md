# Stage 3 — Music Taxonomy Dictionary

Platform-wide controlled vocabulary for SyncBiz music intelligence. **Dictionary only**: no catalog tagging, playlists, workspaces, AI classification, or playback surfaces yet.

## Schema

Prisma enums:

- `MusicTaxonomyCategory`
- `MusicTaxonomyTagStatus`

Model `MusicTaxonomyTag` fields:

| Field | Notes |
|-------|--------|
| `slug` | Unique, stable identifier (`lowercase-kebab-case`). |
| `category` | Enum bucket for grouping / filters. |
| `labelEn`, `labelHe` | Primary labels (English + Hebrew UI copy). |
| `descriptionHeUser` | Short Hebrew explanation for operators (nullable). |
| `descriptionAi` | Notes useful for future ML / retrieval (nullable). |
| `aliases` | Alternate spellings / synonyms (`TEXT[]`). |
| `status` | `ACTIVE`, `DEPRECATED`, `HIDDEN`, `MERGED`. |
| `parentId` | Optional hierarchy (`SET NULL` on delete parent). |
| `mergedIntoId` | Canonical redirect target when `MERGED`. |
| `sortOrder` | Integer ordering within category lists. |

## Migration

Migration folder name: **`20260429124500_music_taxonomy_dictionary`**.

Apply:

```bash
npx prisma migrate deploy
```

Development with local Postgres:

```bash
npx prisma migrate dev
```

## Seeding

Seed loads rows from (first hit wins):

1. `MUSIC_TAXONOMY_SEED_JSON` — absolute or repo-relative path to a JSON array.
2. `prisma/seed-data/music-taxonomy.generated.json` — produced by the Excel importer (recommended once you add the cleaned workbook).
3. Embedded fallback — `lib/music-taxonomy-seed-defaults.ts` (covers every enum bucket with stable slugs).

Upserts by **`slug`** in two phases (scalar fields first, then `parentId` / `mergedIntoId`). Safe to run repeatedly.

Commands:

```bash
npx prisma db seed
```

Or:

```bash
npm run music-taxonomy:seed
```

### Official workbook (`Stage 3 Seed`)

Place `syncbiz_music_taxonomy_stage3_clean.xlsx` anywhere accessible (repo convention: `data/syncbiz_music_taxonomy_stage3_clean.xlsx`), then:

```bash
npm run music-taxonomy:import-xlsx -- "data/syncbiz_music_taxonomy_stage3_clean.xlsx"
```

This reads sheet **`Stage 3 Seed`** (falls back to the first sheet), writes **`prisma/seed-data/music-taxonomy.generated.json`**, then run **`npm run music-taxonomy:seed`** again.

Expected columns (header row, flexible synonyms):

| Column | Synonyms accepted |
|--------|-------------------|
| slug | Slug |
| category | Category |
| labelEn | Label EN, English |
| labelHe | Label HE, Hebrew |
| descriptionHeUser | Description HE User |
| descriptionAi | Description AI |
| aliases | Aliases (comma / semicolon / pipe separated) |
| status | Status |
| parentSlug | Parent slug |
| mergedIntoSlug | Merged into slug |
| sortOrder | Sort order |

### Playlist Pro PDF (`data/playlist-pro-genres.pdf`)

Additional **dictionary** enrichment from the Playlist Pro genre listing (Stage 3 only — not catalog tagging).

1. Generate JSON from the PDF:

```bash
npm run music-taxonomy:enrich-playlist-pro
```

Writes **`prisma/seed-data/music-taxonomy-playlist-pro-enrichment.generated.json`** with deterministic **`playlist-pro-*`** semantic slugs (plus Hebrew overrides). Rows listed in **`lib/music-taxonomy-playlist-pro-merge-config.json`** (`aliasMergeByLabel`) are **omitted** from that JSON; **`music-taxonomy:seed`** appends those vendor strings as **`aliases`** on the canonical Excel slugs after upserts.

2. Run seed as usual (**`npm run music-taxonomy:seed`**). The runner loads primary rows (Excel JSON or embedded defaults), **merges** remaining Playlist Pro rows by **`slug`** (collision: combine **`aliases`** and **`descriptionAi`**), then applies **`aliasMergeByLabel`** merges onto canonical tags.

## SUPER_ADMIN API

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/admin/platform/music-taxonomy/tags` | List tags (`category`, `status`, `q` query params). |
| `POST` | `/api/admin/platform/music-taxonomy/tags` | Create tag (JSON body). |
| `GET` | `/api/admin/platform/music-taxonomy/tags/[id]` | Fetch one tag. |
| `PATCH` | `/api/admin/platform/music-taxonomy/tags/[id]` | Update fields / deprecate / hide / merge. |

All routes return **403** unless the session is a platform **`SUPER_ADMIN`**.

## Platform Admin UI

- **URL:** `/admin/platform/music-taxonomy`
- Filters: category, status, search (slug / English / Hebrew / alias substring).
- Actions: create, edit, deprecate, hide, merge (status `MERGED` + `mergedIntoId`).

## Out of scope (this stage)

No `CatalogItemTaxonomyTag`, playlist tags, workspace preferences, catalog UI, recommendations, AI classification, analytics, playback, desktop, or WebSocket changes.

## Troubleshooting

On Windows, `prisma generate` may fail with `EPERM` renaming `query_engine-windows.dll.node` while another process (for example `npm run dev` / Next.js or another Node process) holds the Prisma engine open. Stop dev servers and IDE tasks that run Prisma, then run `npx prisma generate` again.

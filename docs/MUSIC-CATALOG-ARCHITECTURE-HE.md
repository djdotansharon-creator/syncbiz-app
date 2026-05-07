# SyncBiz · ארכיטקטורת קטלוג המוזיקה — מסמך מקיף בעברית

**גרסה:** 1.0 · **מתאריך:** 2026-05-05 · **ענף:** `wip/dj-creator-v1`
**טווח:** מצב הקטלוג ב-V1 — Stages 3–11 (מילון, תיוג, סדנת אדמין, חיפוש חכם, DJ Creator, Coverage Packs, Readiness/Eligibility).
**קהל יעד:** בעל המוצר וצוות הפיתוח. נכתב כחומר אבן-ליבה לפיתוח עתידי בטוח.

> מסמך זה הוא **תיעוד תיאורי** של מצב הקוד הנוכחי. הוא לא מחליף את `CATALOG-OPERATING-SYSTEM-V1.md`, את ה-roadmap (`CATALOG-DJ-CREATOR-ROADMAP.md`) או את `MUSIC-TAXONOMY-STAGE3.md` — הוא מקשר ביניהם וממקם אותם בתוך תמונה אחת.

---

## 1. תקציר מנהלים

קטלוג המוזיקה של SyncBiz הוא **שכבת אינטליגנציה מוזיקלית גלובלית** היושבת **מעל** מערך הפלייליסטים, הנגנים, וה-WebSocket. המערכת לא מאחסנת מדיה — היא שומרת **זהות קנונית** של פריט מוזיקלי (URL, provider, videoId), מצמידה לו **מילון תגיות עשיר** (ז'אנר, סגנון, התאמה עסקית, חלק יום, אנרגיה, פלייבק־קונטקסט), ועליו בנויות יכולות מוצר:

- **DJ Creator** — אשף בחירה מוסיקלית מבוסס חוקים שנשלפים מקובץ JSON (יצוא XLSX), מתורגם ל"קונטקסט מטריצי" שמועבר ל-Smart Search.
- **Smart Catalog Search** — חיפוש דטרמיניסטי ב־Hebrew/English (ללא AI, ללא embeddings) שמשלב פרסור ביטויים, פרופיל עסקי של ה-Workspace, וניקוד Fit.
- **Music Programming Coverage** — מדידת בריאות "חבילות תכנות" (Packs) שכל אחת מהן היא צירוף של דרישות — לא ציון ז'אנר אחד.
- **Catalog Operating System V1** — שכבה דיאגנוסטית בלבד שמסווגת כל פריט ל-`READY/PARTIAL/NEEDS WORK` ולהיתכנות שימוש בכל זרימה.

**העיקרון הקובע של V1:** כל מה שעוסק בכשירות והתאמה הוא **תצוגתי בלבד**. `assessCatalogItemReadiness` ו-`assessCatalogItemEligibility` *לא נצרכים* בזמן ריצה ע"י DJ Creator או Coverage strict; הם מציגים לעורכים מה הם צריכים לתקן, וההצרכה ב-runtime נשמרת לאחורנית מאחורי feature flag עתידי.

**הפוטנציאל המוצרי:**

- מאפשר לעסק להפעיל סאונדטרק שמתאים לזהות שלו ולחלוקת היום, בלי שמישהו יבחר ידנית.
- מאפשר ל-SyncBiz לבנות **קטלוג גלובלי משותף** שאינו זולג בין Workspaces (אין tenancy על `CatalogItem`), ומקבל תיוג ע"י SUPER_ADMIN בלבד.
- בנוי ל"Catalog-first player search" — משמע, השליטה על איכות החיפוש בנגן עצמו תועבר בעתיד פנימה במקום לסמוך על YouTube/Spotify.
- מאפשר מודל הכנסה עתידי של חבילות (Packs) — ה-`catalog-coverage-targets.json` כבר נושא חבילות עסקיות מוגדרות (לדוגמה `gym-high-energy`, `cafe-morning-calm`, `hospitality-premium-calm`, `bar-night-rhythmic`).

---

## 2. הקשר עסקי וטווח המוצר

SyncBiz היא פלטפורמה שמנהלת **שליטה מוסיקלית בעסקים** (קפה, מסעדה, חדר כושר, בר, ספא, מלון). **קטלוג המוזיקה** הוא הצד ה"חכם" של המוצר — זה מה שמאפשר ללקוח לקבל מוסיקה נכונה לעסק, ליום, למצב הרוח, מבלי לעסוק בבחירה.

הצרכים שהקטלוג נועד לפתור:

| צורך עסקי | המענה במערכת |
|------------|----------------|
| "תן לי מוסיקה לקפה בשעות הבוקר" | DJ Creator + Smart Search + Daypart segmentation |
| "אני רוצה חדר כושר אנרגטי, בלי טראפ נכאה" | DJ Creator עם `avoidStyleSlugs` + intensitiesGym |
| "המנהל רוצה מוסיקה ישראלית בשישי בערב" | מילון `ISRAELI_SPECIALS` + פרופיל עסקי + רמז שפה |
| "האם הקטלוג שלנו מספיק טוב לחבילת `bar-night-rhythmic`?" | `Music Programming Coverage Health Report` |
| "איזה פריטים בקטלוג בעיתיים?" | `Item Readiness` + `Eligibility` (READY/PARTIAL/NEEDS WORK) |
| "אנחנו רוצים לטהר פריטים שבורים בלי לפגוע בפלייליסטים קיימים" | `archivedAt` (soft-archive) + שמירת ה-FK בפלייליסטים |

---

## 3. מודל המידע (Prisma)

הקטלוג בנוי משלוש ישויות־ליבה ושלוש לוויניות:

### 3.1 ישויות ליבה

```text
MusicTaxonomyTag        ───<  CatalogItemTaxonomyTag  >───  CatalogItem
(מילון גלובלי)            (קישור N:N עם provenance)        (קטלוג גלובלי)
```

**`MusicTaxonomyTag` (Stage 3)** — מילון פלטפורמתי מבוקר. שדות מפתח: `slug` (ייחודי), `category` (מתוך 9 קטגוריות), `labelEn/labelHe`, `aliases[]`, `parentId` (היררכיה), `mergedIntoId` (ניתוב לקנוני אחרי merge), `status` (`ACTIVE/DEPRECATED/HIDDEN/MERGED`). זרע נטען מתוך XLSX קנוני, JSON שנוצר מ-Excel, ובהיעדרם מתוך `lib/music-taxonomy-seed-defaults.ts`.

**הקטגוריות:**
`PLAYBACK_CONTEXT`, `VIBE_ENERGY`, `MAIN_SOUND_GENRE`, `STYLE_TAGS`, `ISRAELI_SPECIALS`, `TECHNICAL_TAGS`, `BUSINESS_FIT`, `DAYPART_FIT`, `CATALOG_PROGRAMMING`.

**`CatalogItem`** — שורת זהות לפריט מוזיקלי. שדות מפתח: `url` (UNIQUE), `canonicalUrl` (UNIQUE, nullable), `videoId`, `provider`, `title/artist/durationSec/thumbnail`, `curationRating` (Editorial 0–N, **לא** מטריקת YouTube), `manualEnergyRating` (1–10, nullable; "אנרגיה ידנית" של עורך), `archivedAt` (soft-delete מהדיסקברי בעוד פלייליסטים שומרים את ה-FK).

חשוב: **אין `workspaceId`**. הקטלוג גלובלי לפלטפורמה — ההגנה היא ברמת ה-API (`requireSuperAdmin`).

**`CatalogItemTaxonomyTag` (Stage 4)** — קישור N:N. UNIQUE `(catalogItemId, taxonomyTagId)`. נושא `source` (כיום `MANUAL` בלבד; ה-enum מוכן ל-`ML_IMPORT` בעתיד), `confidence` (nullable), `createdById`. כאן כל ה"חוכמה" הישומית של הקטלוג מתגבשת.

### 3.2 לוויניות

| מודל | תפקיד | הערות |
|------|--------|---------|
| `CatalogSourceSnapshot` (Stage 5.9) | תמונת־מצב **append-only** של מטא-דאטה ממקור (YouTube/yt-dlp): `viewCount`, `likeCount`, `commentCount`, `publishedAt`, `hashtags`, `rawJson`. | לא דורסת אוטומטית את `CatalogItem`. לוגי append עם `fetchedAt`. |
| `CatalogAnalytics` | אגרגציה פנימית: `playCount`, `lastPlayedAt`, `aiDjCount`, `trendingScore`. | UNIQUE לפי `catalogItemId`. |
| `CatalogPlayByBusiness` | פירוק נגינות לפי `BusinessType`. | משמש את ה-`Top Dashboard` של ה-Workbench. |

### 3.3 פלייליסטים מול קטלוג

`Playlist` ו-`PlaylistItem` שומרים `catalogItemId` כ-FK רך — וזה מה שמאפשר archive בטוח של פריט בקטלוג מבלי לשבור פלייליסטים.

---

## 4. השכבות המוצריות (תרשים בלוקים)

```
┌─ Admin Platform UI ─────────────────────────────────────────────────────┐
│  /admin/platform/music-taxonomy        ← מילון: תוספת/עריכה/דה-פרקציה   │
│  /admin/platform/catalog-tagging       ← Workbench: דפדוף, סינון, תיוג │
│  /admin/platform/catalog-coverage      ← דשבורד בריאות חבילות + תור    │
│  /admin/platform/smart-search          ← תצוגה מקדימה Smart Search      │
│  /admin/platform/recommendation-*      ← Coverage / Preview עזריים     │
└─────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─ lib/recommendations (גרעין האינטליגנציה) ──────────────────────────────┐
│  parse-smart-catalog-query    ─ פרסור עברית/אנגלית דטרמיניסטי           │
│  smart-catalog-search          ─ ניקוד Fit + Editorial bumps + ranking  │
│  score-catalog-fit             ─ ניקוד Fit מבוסס חוקים נטענים           │
│  load-fit-rules                ─ JSON Schema + אימות זוד                │
│  load-business-daypart-vibe    ─ מטריצת עסק×חלק־יום×Vibe                │
│  daypart-segment-map           ─ סלוג Daypart  →  segment              │
│                                                                         │
│  dj-creator-rules              ─ טעינת Bundle, מיפוי wizard→matrix      │
│  dj-creator-rules.types        ─ טיפוסי כללי DJ                         │
│  dj-creator-search-context     ─ "DJ context" שעובר ל-Smart Search      │
│  dj-creator-coverage           ─ tier (good/partial/none) לקאלוג עצמו   │
│  dj-creator-client-filters     ─ סינוני wizard בצד לקוח                 │
│                                                                         │
│  catalog-coverage-targets.types/json  ─ חבילות תכנות (Packs)            │
│  catalog-coverage-health       ─ דוח בריאות פר-Pack                     │
│  catalog-coverage-work-queue   ─ תור עבודה לעורכים                       │
│  catalog-item-readiness        ─ Stage 9 — שער איכות לפריט               │
│  catalog-item-eligibility      ─ Stage 10 — דגלי זכאות לזרימה            │
└─────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─ Prisma ────────────────────────────────────────────────────────────────┐
│  CatalogItem · MusicTaxonomyTag · CatalogItemTaxonomyTag                │
│  CatalogSourceSnapshot · CatalogAnalytics · CatalogPlayByBusiness       │
│  WorkspaceBusinessProfile (חיבור לעסק)                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. מילון המוזיקה (Music Taxonomy Dictionary)

**מטרה:** וקבולרי מבוקר אחיד לכל הפלטפורמה. אין לתייג CatalogItem בתגית שאינה במילון.

**איך הוא נטען (סדר חיפוש):**
1. נתיב בקובץ סביבה `MUSIC_TAXONOMY_SEED_JSON`.
2. `prisma/seed-data/music-taxonomy.generated.json` (פלט של ייבוא XLSX).
3. Embedded fallback ב-`lib/music-taxonomy-seed-defaults.ts`.

**שני שלבי upsert:** קודם השדות הסקלריים, אחר כך `parentId` ו-`mergedIntoId` — כדי לוודא שהיררכיה לא נשברת בריצות חוזרות.

**השלמות מ-Playlist Pro:** הסקריפט `music-taxonomy:enrich-playlist-pro` יוצר slugs מסוג `playlist-pro-*`. כללי המיזוג מנוהלים ב-`lib/music-taxonomy-playlist-pro-merge-config.json` — שמירה על שורש קנוני אחד ושאר השמות נכנסים כ-`aliases`.

**API מנהלי:**

```
GET    /api/admin/platform/music-taxonomy/tags
POST   /api/admin/platform/music-taxonomy/tags
GET    /api/admin/platform/music-taxonomy/tags/[id]
PATCH  /api/admin/platform/music-taxonomy/tags/[id]
```

הכל מוגן `requireSuperAdmin`; משתמש Workspace רגיל אינו מסוגל לקרוא או לכתוב למילון.

---

## 6. סדנת התיוג (Catalog Tagging Workbench — Stages 4–5)

הדף `/admin/platform/catalog-tagging` הוא ה-IDE של עורכי הקטלוג. הוא נבנה בכמה שכבות:

1. **Browse-first** — רשימה ראשית לפי `LIST_LIMIT = 100` עם סינונים לפי ז'אנר/סטטוס/תור עבודה/usage tier.
2. **Top Dashboard** — `CatalogWorkbenchTopDashboard`: סך הפריטים, ארכיון, סטטוס תור, חלוקה לפי `usage tier` (HIGH/MEDIUM/LOW/NOT_USED) — מחושב מ-`PlaylistItem`, `CatalogPlayByBusiness`, ו-Schedule.
3. **Editor Panel** — שורת הפריט פותחת כניסה לעריכה:
   - `CatalogItemTaxonomyEditor` — ה-multi-tag editor (קטגוריות), עם `metadataSuggestions` המסתמכים על Snapshot.
   - `CatalogManualEnergyEditor` — אנרגיה ידנית 1–10.
   - `CatalogCurationEditor` — `curationRating` ידני + הערות.
   - `CatalogDisplayTitleEditor` — אם צריך title לעריכה ידנית.
   - `CatalogSourceMetadataPanel` — תצוגה ופעולה (`refresh`) של Snapshots.
   - `CatalogMetadataBackfillPanel` — מילוי חסרים בכמות.
   - `CatalogWorkbenchItemActions` — Archive/Restore.
4. **Stage 8 deep-link banner** — `CatalogTaggingScrollToEditor` קולט `coverageWorkbenchContext` (פריט הגיע מ-Coverage), גוללת לעורך, מציגה באנר "Coming from pack X · missing Y" עם קישור חזרה ל-Coverage.
5. **Stage 9/10 panels** — פאנל Readiness ופאנל Eligibility (ראו §10) שמתעדכנים live עם השמירות.

---

## 7. תמונות־מצב ממקור (`CatalogSourceSnapshot`, Stage 5.9)

המוטיב המרכזי: **append-only**. בכל ריענון נשמרת שורה חדשה (`fetchedAt`), אין דריסה אוטומטית של `CatalogItem.title/thumbnail/durationSec`. עורך יכול להחליט להחיל ה-`metadataSuggestions` כתיוג, אבל אין auto-apply.

המודל כבר מוכן לשדות העתידיים של "Catalog Source Extended Metadata" (ראו `docs/CATALOG-SOURCE-METADATA-FUTURE.md`): `sourcePublishedAt`, `sourceViewCount`, `sourceLikeCount`, `sourceCommentCount`, `sourceStatsFetchedAt`, `sourceStatsProvider`, `sourceStatsUnavailableReason`. **זה לא ממומש עדיין** — מסומן Future.

המוצר מבחין במפורש בין:
- **`Snapshot.viewCount/likeCount`** — מטא-דאטה מבחוץ (טכני).
- **`CatalogAnalytics.playCount`** — נגינות פנימיות (אנליטיקס פנים).
- **`curationRating`** — ציון אדיטוריאלי ידני (לא נספר אוטומטית).

לעולם לא לערבב.

---

## 8. אנרגיה ידנית (Stage 6.2A — display only)

`CatalogItem.manualEnergyRating` הוא Int? בטווח 1–10. נכנס מ-`CatalogManualEnergyEditor` ב-Workbench. **הסיווג העסקי** של אנרגיה הוא 0–10 (כולל 0 = ambient/אין-תופי).

ה-mapping בין אנרגיה ל-BPM (planning בלבד; ראה `docs/ENERGY-INTELLIGENCE-STAGE-6-2.md`) הוא **תצוגתי** — לא משפיע עדיין על ניקוד או סינון. השלב הבא הוא Stage 6.2 שיוסיף שדות אנרגיה במילון `(energyLevelMin/energyLevelMax/energyLevelDefault)` ו-BPM בכלל הניקוד, בכפוף לאישור.

---

## 9. החיפוש החכם (Smart Catalog Search — Stage 6 V1)

### 9.1 פרסור (`parse-smart-catalog-query.ts`)

פרסור דטרמיניסטי בעברית/אנגלית — אין AI, אין embeddings. הוא מזהה:

- `businessType` (BusinessType) — מתוך מילות מפתח.
- `coarseDaypart` (`morning/lunch/dinner/night`).
- `vibeSegment` — סגמנט מטריצת עסק×חלק־יום×Vibe.
- `moodHints[]`, `energyHint`, `audienceHints[]`, `conceptTags[]`.
- `styleTaxonomySlugs[]` — slugs שהפרסר מציע, גם אם לא קיימים במילון. הקריאה משווה למילון בפועל ושוטחת `parserTaxonomyInDictionary` להבחנה ברורה.
- `matchedPhrases[]` — לתצוגה לעורך (מה זוהה בפועל בטקסט).

### 9.2 ניקוד (`score-catalog-fit.ts` + `smart-catalog-search.ts`)

`runSmartCatalogSearch` שולף עד `MAX_CATALOG_SCAN = 4000` פריטים פעילים, מפעיל `rankCatalogItemsByFit` עם `WorkspaceFitContext` (מה-Workspace וה-parsed query), ומוסיף Tiny Editorial Bumps:

- `CURATION_WEIGHT = 0.012` — תוספת קלה ל-`curationRating` שאין מספיק כדי לשרוף תוצאה רלוונטית פחות.
- `POP_LOG_WEIGHT = 0.004` — לוג של נגינות פנימיות (`CatalogAnalytics.playCount`).

המוצר מקפיד: **`displayScore` ≠ `baseFitScore`**. ה-fit נקי, ה-display זה מה שהמשתמש רואה.

### 9.3 דאיברט DJ (DJ Creator integration)

`runSmartCatalogSearch` מקבל אופציונלית:

- `avoidStyleSlugs[]` — פריטים שבעלי slug כלשהו ברשימה הזאת מסוננים *לפני* הניקוד (full-tag-set exclusion).
- `djContext` — קונטקסט מטריצי שמגיע מ-`computeDjCreatorMatrixKey` (`businessId/daypartId/vibeId/intensityId`); מאפשר ל-DJ Creator להעביר tip ל-search.

תגובת ה-API (`/api/catalog/smart-search`) מחזירה:

```ts
{
  parsed, profileUsed, coarseDaypart, vibeSegment,
  fitRulesVersion, vibeRulesVersion,
  rows[], dictSlugCount, parserTaxonomyInDictionary[],
  djAvoidStyleFilterApplied, coverage, isSuperAdmin
}
```

---

## 10. DJ Creator V1

### 10.1 הקונספט

DJ Creator הוא אשף קצר שלוקח מהמשתמש שלוש בחירות (Business / Daypart / Vibe), ולפעמים גם Style ו-Language, ומחזיר רשימה ממורכזת של פריטים מהקטלוג. הוא **לא** מנגן בעצמו — הוא מציע, והמשתמש שומר ל-Local Playlist (ראו `savePlaylistToLocal` ב-`unified-sources-client`).

### 10.2 חוקי DJ (`dj-creator-rules.generated.json`)

הכללים נטענים פעם אחת מ-JSON שנוצר מתוך XLSX (`npm run dj-creator:import-rules`). Runtime לעולם לא קורא XLSX. כל שורה (`DjCreatorRuleRow`) מכילה:

- `businessType / daypart / vibe / energy / audience` — תאי המטריצה. `*` או ריק = wildcard.
- `styleQuestionHe` + `styleOptionsForWizard[]` — שלב סגנון ב-wizard.
- `styleSlugHints[]`, `defaultStyleSlugs[]`, `avoidStyleSlugs[]` — חיזוקי/חסימות slugs.
- `languageOptions[]`.
- `resultCountDefault`, `explanationHe`.

המיפוי מ-id של ה-wizard ל-rule:

| Wizard | Rule |
|--------|------|
| `gym` | `GYM` |
| `cafe` | `CAFE` |
| `restaurant` | `RESTAURANT` |
| `hotel` | `HOTEL_LOBBY` |
| `bar` | `BAR_NIGHTLIFE` |
| `spa` / `other` | `OTHER` |

ל-`evening` יש לוגיקה מיוחדת (`mapWizardDaypartForRuleDaypart`): אם ה-vibe upbeat → שורות `evening`; אם dinner mood → שורות `dinner`. זה הניואנס שמבדיל "ערב חברים" מ"ערב שקט" באותה שעה.

### 10.3 זרימה מלאה

```
משתמש בוחר ב-DJ Creator AI shell
        │
        ▼
buildDjCreatorMatchContextFromWizard()  →  matchDjCreatorRule()
        │                                       │
        ▼                                       ▼
 effectiveResultCount()                  styleSlug hints + avoidSlugs
        │                                       │
        ▼                                       ▼
       computeDjCreatorMatrixKey()  →  GET /api/catalog/smart-search
                                              │
                                              ▼
        runSmartCatalogSearch( ..., djContext, avoidStyleSlugs )
                                              │
                                              ▼
                          rows[] + computeDjCreatorCoverage(tier)
                                              │
                                              ▼
                                   UI: צ'יפים, באנר tier, שמירה לפלייליסט
```

**fallback אנושי:** אם הכיסוי לא מספיק, יש כפתור "Editor Request" שמייצר NDJSON ב-`data/dj-creator-editor-requests.ndjson` (POST `/api/dj-creator/editor-request`) — אין מייל, אין הבטחה ל-AI, רק תור אנושי.

### 10.4 בדיקות

יש Playwright spec (`e2e/dj-creator-gym-context.spec.ts`) שמכסה את מסלול ה-Gym כולל בחירת אינטנסיביות, בחירת שפה, מסך review ו-composer free-text. זוהי ה-Definition-of-Done לסגירת Stage 6 V1.

---

## 11. כיסוי תכנות מוזיקלי (Music Programming Coverage — Stage 7)

### 11.1 העיקרון

חוצה־קוד-וחוצה־doc: **Coverage היא ערימה של צירים נפרדים**, לא ציון ז'אנר אחד. ז'אנר, סגנון, התאמה עסקית, חלק יום, אנרגיה, סוג URL ואותות אדיטוריאליים — *מאוחדים בחבילה (Pack), לא מתמזגים לציר אחד*. הכלל הזה כתוב מפורש ב-`dj-creator-coverage.ts` וב-`CATALOG-DJ-CREATOR-ROADMAP.md §1`.

### 11.2 חבילות תכנות (`catalog-coverage-targets.json`)

החבילות הנוכחיות (6, ב-V1):

- `hospitality-premium-calm`
- `cafe-morning-calm`
- `gym-high-energy`
- `bar-night-rhythmic`
- `spa-wellness-calm`
- `beach-sunset-groove`

כל חבילה כוללת רשימות slugs לפי משפחה (`businessFitTags`, `daypartTags`, `vibeTags`, `genreTags`, `styleTags`, `catalogProgrammingTags`), משפחות נדרשות/אופציונליות/נמנעות, מינימום פריטים, ספירות single/set-mix, טווח אנרגיה, allowlist של URL types, ו-`missingSlugs` — slugs שהחבילה דורשת אבל אינם במילון בפועל.

### 11.3 דוח בריאות (`catalog-coverage-health.ts`)

`generateCatalogCoverageHealthReport` מחזיר עבור כל Pack:

- `totalMatching` — פריטים שעוברים avoid + URL allowlist + יש להם חפיפה בחבילה (any dimension).
- `withGenreTags / withStyleTags / withBusinessFitTags / withDaypartTags / withVibeTags` — הפילוג לפי דרישה.
- `withEnergyInTargetRange` — `manualEnergyRating` בטווח החבילה.
- `singleCount/setMixCount/otherUrlShapeCount` — חתך URL shape.
- `targetMinimumItems / gapMinimumItems / gapSingle / gapSetMix` — פערים.
- `healthStatus` — `healthy / weak / critical`.
- `topMissingDimensions[]`, `recommendedEditorAction` — טקסט פעולה.
- `strictAllDeclaredDimensionsCount` — פריטים שמספקים את **כל** הצירים הלא-ריקים בחבילה.

לצד הדוח קיים **`catalog-coverage-work-queue.ts`** שמייצר תור מועמדי תיוג עם הקשר חבילה — כך שכל candidate שעורך פותח מגיע עם "אתה כאן בגלל החבילה X, חסרה לך הדימנסיה Y, אנרגיה אידיאלית Z".

### 11.4 דשבורד אדמין

`/admin/platform/catalog-coverage` — תצוגת בריאות + רשימת Close-candidate עם pill (`LIMITED` / `BLOCKED`), ולחצן "Open in tagging" שמעביר עם `coverageWorkbenchContext` מלא לעורך התיוג.

---

## 12. מערכת ההפעלה של הקטלוג (Operating System V1 — Stages 9–11)

### 12.1 Stage 9 — Item Readiness

`assessCatalogItemReadiness` ב-`lib/recommendations/catalog-item-readiness.ts`. פונקציה טהורה. סווגת כל פריט ל-`ready / partial / needs-work` לפי:

**דרישות hard:**
- `MAIN_SOUND_GENRE` ≥1 קישור
- `STYLE_TAGS` ≥1 קישור
- `BUSINESS_FIT` או `PLAYBACK_CONTEXT` ≥1 קישור
- `DAYPART_FIT` ≥1 קישור
- `manualEnergyRating ∈ [1, 10]`
- `URL type` מזוהה
- `durationSec > 0` או `provider` מוכר

**אזהרה רכה:** Thumbnail חסר → warning, לא חוסם.

**Overrides שכופים `needs-work`:**
- URL type לא מזוהה → אוטומטית `needs-work` (וגם פוסל מ-Coverage strict).
- `manualEnergyRating` לא מוגדר **וגם** אין duration **וגם** אין provider → `needs-work`.

### 12.2 Stage 10 — Item Eligibility

`assessCatalogItemEligibility` ב-`lib/recommendations/catalog-item-eligibility.ts` ממפה את ה-readiness לדגלים פר־זרימה:

| דגל | True כאשר |
|------|------------|
| `djCreatorStrictEligible` | `status === "ready"` וגם energy מוגדר ב-[1,10] |
| `djCreatorAnyEligible` | `status !== "needs-work"` |
| `coverageStrictMatchEligible` | URL type מזוהה |
| `adminVisible` | תמיד true |

טיירים: `fully-eligible / limited / blocked`.

### 12.3 Stage 11 — Operating System V1 (Finalization)

`docs/CATALOG-OPERATING-SYSTEM-V1.md` הוא ה-day-to-day playbook לעורך:
1. פותח Coverage Dashboard, בוחר חבילה הכי חלשה.
2. לוחץ "Open in tagging" → רואה Coverage banner, Readiness panel, Eligibility panel.
3. מתקן בסדר העדיפות: URL type → Energy → Genre/Style/Fit → Daypart → Thumbnail.
4. שומר; כל הפאנלים מתעדכנים live.

> **כלל ברזל של V1:** Readiness ו-Eligibility הם **דיאגנוסטיקה לתצוגה בלבד**. הם לא נצרכים ב-DJ Creator selection ולא ב-Coverage strict matching. ההצרכה (behind feature flag) היא Future Work.

---

## 13. שכבת ה-API

| Endpoint | תפקיד | הגנה |
|----------|--------|---------|
| `GET /api/admin/platform/music-taxonomy/tags` | ניהול מילון | `SUPER_ADMIN` |
| `POST/PATCH /api/admin/platform/music-taxonomy/tags[/:id]` | יצירה/עדכון | `SUPER_ADMIN` |
| `POST /api/admin/platform/catalog-items/:id/taxonomy-tags` | קישור פריט↔תג | `SUPER_ADMIN` |
| `DELETE .../taxonomy-tags/:taxonomyTagId` | ניתוק | `SUPER_ADMIN` |
| `PATCH .../manual-energy-rating` | אנרגיה ידנית | `SUPER_ADMIN` |
| `PATCH .../curation` / `.../title` | קוריישן/כותרת | `SUPER_ADMIN` |
| `POST .../source-metadata/refresh` · `GET .../latest` | snapshots | `SUPER_ADMIN` |
| `POST .../archive` · `POST .../restore` | ארכוב soft | `SUPER_ADMIN` |
| `POST .../backfill-metadata` | מילוי גורף | `SUPER_ADMIN` |
| `GET /api/catalog/search` | חיפוש בסיסי | משתמש מאומת |
| `GET /api/catalog/smart-search` | Smart Search מלא | משתמש מאומת + active workspace cookie |
| `POST /api/dj-creator/editor-request` | תור עריכה אנושי | משתמש מאומת |

---

## 14. גבולות, חוזים ואיסורים שאסור לשבור

ה-codebase מכיל סדרת "Hard Rules" שמופיעות חוזרות במסמכים. רישומן כאן כשורה אחת לכל אחד:

1. **אסור** ל-`assessCatalogItemReadiness/Eligibility` להשפיע על ריצה (ניקוד/סינון/בחירה) ב-V1.
2. **אסור** ל-`Snapshot` לדרוס אוטומטית את `CatalogItem`.
3. **אסור** למחוק `CatalogItem` קשה — רק `archivedAt`.
4. **אסור** למזג צירי Coverage לציר יחיד; חבילה מצרפת, לא ממזגת.
5. **אסור** לשנות ניקוד (`score-catalog-fit`, `smart-catalog-search`) בלי החלטה מפורשת.
6. **אסור** לקרוא XLSX ב-runtime; רק את ה-JSON המיוצא.
7. **אסור** לגעת ב-`components/library-input-area.tsx` ללא בקשה מפורשת (rule: `library-search-url.mdc`).
8. **אסור** ל-API קטלוג להיות חשוף בלי `requireSuperAdmin` (פרט ל-Smart Search שיש לו אימות משתמש).
9. **אסור** להוסיף `workspaceId` ל-`CatalogItem` — הקטלוג גלובלי בכוונה.
10. **אסור** לקדם Stage 6.2 (אנרגיה־בניקוד / BPM) לפני אישור פורמלי.

---

## 15. סיכוני מערכת וחובות טכניים

### 15.1 חוסר אכיפה של Eligibility בריצה

ה-helpers ה-purest שיש בקוד, אבל הם לא מסננים בפועל. כתוצאה: DJ Creator עלול לבחור פריט שמסומן `BLOCKED` ב-UI. זה מכוון ל-V1, **אבל אם לא נכניס את ההצרכה תחת flag עד מהדורה אחת או שתיים, אינטגריטי המערכת ייפגע**.

### 15.2 תלות ב-`yt-dlp` מהשרת

`lib/yt-dlp-search.ts` נשענת על CLI חיצוני. מסומן `serverExternalPackages` ב-`next.config.ts`, אבל:
- שינוי ב-yt-dlp עלול להשבית את ה-Snapshots.
- אין fallback אוטומטי ל-YouTube Data API (זה Future).

### 15.3 קטלוג גלובלי + תיוג רגיש לעורכים בודדים

`SUPER_ADMIN` יחיד יכול לשנות תגיות שמשפיעות על **כל** ה-Workspaces. אין כרגע audit trail פר-link (רק `createdById`). הוספת `updatedById` + log עריכה היא חוב סביר.

### 15.4 פערי דיקציונרי

`Pack.missingSlugs` חושף ש-Packs מצטטים slugs שלא קיימים במילון. זה אינדיקציה שהמילון איננו עדיין mirror מלא של המוצר. דורש משימת תוכן חוזרת.

### 15.5 אנרגיה ידנית בלבד

אין מקור AI/Analysis לאנרגיה — הכל ידני. בקטלוג של אלפי פריטים, זה bottleneck. Stage 6.2 פותר חלקית אבל עדיין ידני.

### 15.6 חוסר בכיסוי E2E רחב

יש spec ל-Gym Context בלבד. שאר ה-Packs (`bar`, `cafe`, `hospitality`, `spa`, `beach`) ללא Playwright — חוב לפני סגירת Stage 6 רשמית.

### 15.7 כפילויות `desktop/staged-web/` ו-`.next/standalone/`

ה-Glob מראה שכל קובץ קטלוג/DJ קיים גם תחת `desktop/staged-web/` ו-`.next/standalone/`. זו תוצאה של תהליך הבנייה (Electron staging), אבל יוצר בלבול בחיפוש. **לא לערוך** קבצים שם — הם נכתבים מחדש בכל build.

---

## 16. כיוונים עתידיים (Future Work)

מבוססים על `CATALOG-OPERATING-SYSTEM-V1.md §8` ו-`CATALOG-DJ-CREATOR-ROADMAP.md §10.1`:

1. **חיווט Eligibility ל-runtime** — DJ Creator strict packs ו-Coverage strict matching יצרכו את `assessCatalogItemEligibility`. Behind flag, מהדורה אחת לאימות, אז קבוע. **הצעד החשוב ביותר**.
2. **Stage 6.2 — Energy Intelligence** — שדות `energyLevelMin/Max/Default` במילון; BPM כסיגנל soft בניקוד; `CatalogItem.bpmOverride` יגבור על default מהמילון. רק אחרי אישור Stage 6.
3. **Stage 7 (אינפורמלי) — Source Extended Metadata** — שדות real `sourceViewCount/likeCount/publishedAt` על `CatalogItem` (או על `CatalogUrl` נפרד אם נחליט להפריד identity). מציע fallback ל-yt-dlp כשאין quota ל-YouTube Data API.
4. **Stage 9 (אינפורמלי) — Catalog-first player search** — `library-input-area` בנגן יבדוק את הקטלוג הפנימי לפני ספקים חיצוניים. דורש coordination עם פלייליסט rules.
5. **Bulk Readiness CLI** — `npm run catalog:readiness-report` מייצא JSONL/CSV עם counts לפי provider/workspace/pack.
6. **Auto-suggested fixes** — להציע ל-`Missing · X` slugs ספציפיים מתוך `metadataSuggestions` (ללא auto-apply).
7. **Wizard preflight** — מסך תצוגה מקדימה של ה-pool ב-DJ Creator: כמה `LIMITED` יש לפני commit.
8. **BLOCKED → archive nudge** — האם פריטים `blocked` באופן קבוע ראויים ל-archive? צריך החלטת מוצר.
9. **Affinity Branches** — `lib/recommendations/music-affinity-branches.types.ts` הוא scaffold בלבד; לחבר אותו ל-DJ Creator/Smart Search הוא scope נפרד.
10. **CATALOG_PROGRAMMING content** — קטגוריית התגיות הזאת קיימת אך ריקה תוכנית.

---

## 17. נספח A — מפת קבצים מהירה

| תחום | קובץ |
|------|--------|
| מילון | `prisma/schema.prisma` (`MusicTaxonomyTag`), `lib/music-taxonomy-seed-defaults.ts`, `prisma/seed.ts` |
| קטלוג | `prisma/schema.prisma` (`CatalogItem` ואילך), `lib/store.ts`, `lib/catalog-store.ts` |
| Workbench | `app/admin/platform/catalog-tagging/page.tsx`, `components/admin/catalog-*.tsx` |
| Coverage | `app/admin/platform/catalog-coverage/page.tsx`, `lib/recommendations/catalog-coverage-*.ts(/json)` |
| Smart Search | `lib/recommendations/smart-catalog-search.ts`, `parse-smart-catalog-query.ts`, `score-catalog-fit.ts`, `app/api/catalog/smart-search/route.ts` |
| DJ Creator | `lib/recommendations/dj-creator-*.ts(/json)`, `components/dj-creator-ai-shell.tsx`, `components/dj-creator-hub-panel.tsx`, `app/api/dj-creator/editor-request/route.ts` |
| OS V1 | `lib/recommendations/catalog-item-readiness.ts`, `catalog-item-eligibility.ts`, `docs/CATALOG-OPERATING-SYSTEM-V1.md` |

---

## 18. נספח B — סקריפטים ופקודות

```bash
# מילון
npm run music-taxonomy:seed
npm run music-taxonomy:import-xlsx -- "data/syncbiz_music_taxonomy_stage3_clean.xlsx"
npm run music-taxonomy:enrich-playlist-pro

# DJ Creator
npm run dj-creator:import-rules

# Coverage
npm run catalog-coverage:report
npm run catalog-coverage:work-queue

# בדיקות
BASE_URL=http://localhost:3000 npx playwright test e2e/dj-creator-gym-context.spec.ts
```

---

## 19. נספח C — הבחנה מושגית מדויקת (יקר ולא לבלבל)

| מושג | מה זה | מה זה **לא** |
|------|---------|------------|
| `curationRating` | ציון אדיטוריאלי **ידני** של SyncBiz | לא views, לא likes, לא algorithmic |
| `manualEnergyRating` | אנרגיה ידנית 1–10 שעורך הזין | לא BPM, לא energyLevel של ה-Workspace |
| `CatalogAnalytics.playCount` | נגינות פנימיות ב-SyncBiz | לא views של YouTube |
| `Snapshot.viewCount` | views של פלטפורמת המקור | לא play count פנימי |
| `Music Programming Coverage` | בריאות חבילה רב-צירית | לא "ציון ז'אנר" |
| `Readiness` | האם פריט "בנוי טוב מספיק"? | לא relevance לקונטקסט מסוים |
| `Eligibility` | אילו זרימות יכולות להשתמש בפריט? | לא בקרת ריצה (לא נצרך ב-V1) |
| `archivedAt` | soft-remove מ-discovery | לא מחיקה; פלייליסטים שומרים את הפריט |
| `provider` | סוג המקור הטכני (youtube/spotify/local/...) | לא איכות, לא רלוונטיות |

---

**סיום.**
המסמך הזה הוא תיעוד התחלתי. הוא נכתב בכוונה כך שאם בעוד שישה חודשים מצטרף מפתח חדש, הוא יוכל לקרוא אותו פעם אחת ולהבין למה שום אחד לא צריך לשנות `score-catalog-fit.ts` בלי שיחה, למה Eligibility לא נצרך, ולמה החבילה היא צירוף ולא מיזוג. אם משהו במסמך אינו תואם לקוד — *הקוד הוא האמת*, והמסמך זה החוב.

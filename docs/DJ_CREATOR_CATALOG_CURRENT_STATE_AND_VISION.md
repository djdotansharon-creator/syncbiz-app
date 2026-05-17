# SyncBiz Catalog & DJ Creator AI — Current State, Strengths, Gaps, and Path to World-Class AI Music Curation

**ענף Git נבדק:** `wip/dj-creator-v1`  
**ייחוס קומיטים:** היסטוריית `git log` על הענף (שבוע–שבועיים אחרונים של עבודת קטלוג + DJ Creator).  
**הערה מתודולוגית:** המסמך מבוסס על קריאת קוד בפועל (`schema`, ליבות המלצות, API, Admin). מקומות שלא נבדקו בזמן אמת מסומנים כ־**צריך אימות נוסף**.

---

## 1. Executive summary

**SyncBiz** היא מערכת SaaS לבקרה על מוזיקה ומדיה מבוססת־URL בעסקים. המערכת **אינה מאחסנת קבצי אודיו**; היא מנהלת מקורות (URLs), פלייליסטים, תזמון, בקרת נגינה, הפרדת workspace/סניף, ושכבת **אינטליגנציה גלובלית של קטלוג** לצד **DJ Creator AI** — עוזר שמטרתו, בשלבים מתקדמים, להבין הקשר עסקי (סוג עסק, קהל, שעה, אנרגיה, ז׳אנר, אווירה) ולהציע או לבנות פלייליסטים עדיפים על עורך אנושי.

**היום:** קיים **קטלוג גלובלי** (`CatalogItem`) עם **מילון טקסונומיה** (`MusicTaxonomyTag`) וקישורים ידניים מנוהלים (`CatalogItemTaxonomyTag`), **חיפוש קטלוג חכם** (Smart Catalog Search) שמשלב פרופיל workspace, כללי fit, וטוקנים מפורשים מהשאילתה, ו־**DJ Creator AI V1** — אשף לקוח שקורא ל־API החיפוש, מציג המלצות מבוססות־קטלוג, מאפשר שמירת פלייליסט, ונופל ל־**בקשת עורך אנושי** כשהכיסוי חלש.

**גשר חדש ומבוקר:** נוסף נתיב שמאפשר ל־**SUPER_ADMIN** להחיל **במפורש** (allowlist) תיוג ממטא־דאטה של פלייליסט על **פריטי קטלוג** שכבר מקושרים דרך `PlaylistItem.catalogId` — בלי סנכרון אוטומטי ובלי לערבב אמת גלובלית עם תוויות שכבת־דייר.

**שלב הבשלות:** ארכיטקטורת היסוד (קטלוג → טקסונומיה → חיפוש → DJ Creator) קיימת ופעילה; השלמת **כיסוי קטלוג**, **ממשק גיבוי לגשר**, **מקור מוצא (provenance)** לתיוגים שמגיעים מהגשר, ולולאת משוב—עדיין לפנינו.

---

## 2. What was built this week

להלן מה שנסגר **בפועל בקוד** לפי קומיטים אחרונים על `wip/dj-creator-v1` (ולא לפי זיכרון בלבד):

| כיוון | מה נוסף / התחזק | קבצים / מושגים מרכזיים |
|--------|-------------------|-------------------------|
| **כיוון catalog-first** | קטלוג כמקור אמת גלובלי לזהות המוזיקה (URL), עם טקסונומיה מנוהלת ועם דשבורדים לאדמין | `prisma/schema.prisma` (`CatalogItem`, `MusicTaxonomyTag`, `CatalogItemTaxonomyTag`, `CatalogSourceSnapshot`, `CatalogAnalytics`, `CatalogPlayByBusiness`), דפי `app/admin/platform/catalog-tagging`, `catalog-coverage`, `music-taxonomy`, `smart-search` |
| **יסודות טקסונומיה** | קטגוריות בשכבת המוזיקה (`MusicTaxonomyCategory`), מילון slug ייחודי, קישור N:M לקטלוג | `MusicTaxonomyTag`, `CatalogItemTaxonomyTag`, זרעים תאורטיים: `prisma/seed-data/music-taxonomy.generated.json` |
| **מטא־דאטה לפלייליסט (דייר)** | אוצר מילולי ל־use case / genre / mood / energy נשמר ב־`Playlist` וב־JSON דרך טפסים | `lib/playlist-metadata-registry.ts`, `lib/playlist-types.ts`, `components/edit-playlist-form.tsx` |
| **Smart Catalog Search** | ארכיטקטורת ריצה: פירוש שאילתה, פרופיל workspace, כללי fit + daypart/vibe, דירוג, מסנן DJ (avoid + אנרגיה ידנית) | `lib/recommendations/smart-catalog-search.ts`, `lib/recommendations/parse-smart-catalog-query.ts`, `lib/recommendations/score-catalog-fit.ts`, `app/api/catalog/smart-search/route.ts` |
| **DJ Creator V1** | אשף UI, קריאה ל־smart search, שמירת פלייליסט ב־`/api/playlists`, Hub, בקשת fallback לעורך | `components/dj-creator-ai-shell.tsx`, `components/dj-creator-hub-panel.tsx`, `lib/recommendations/dj-creator-rules.ts`, `lib/recommendations/dj-creator-search-context.ts`, `app/api/dj-creator/editor-request/route.ts` |
| **ריענון ואיכות פריט** | שער “מוכנות” (readiness), נגזרת שימוש (eligibility) ללא כתיבה אוטומטית | `lib/recommendations/catalog-item-readiness.ts`, `lib/recommendations/catalog-item-eligibility.ts` |
| **כיסוי המלצות ב־DJ Creator** | היוריסטיקת `coverage` (good/partial/none) על תוצאות החיפוש | `lib/recommendations/dj-creator-coverage.ts` (מחושב ב־`GET /api/catalog/smart-search`) |
| **גשר playlist → טקסונומיית קטלוג** | POST מוגן ל־SUPER_ADMIN: מיפוי allowlist בלבד, דיווח על חסרים/כפולים | `lib/playlist-metadata-catalog-taxonomy-map.ts`, `app/api/admin/platform/playlists/[id]/apply-mapped-catalog-taxonomy/route.ts` |

**גילוי מרכזי:** שדות כמו `Playlist.subGenres`, `useCases`, `mood`, `energyLevel` הם **שכבת תפעול דיירית** (מועילה לעורכים ולמוצר), בעוד **DJ Creator Smart Search** נשען על **קישורי `CatalogItemTaxonomyTag`** לטקסונומיה הגלובלית. אין משמעות שמטא־דאטה של פלייליסט תשדרג אוטומטית את האינטליגנציה הגלובלית בלי מיפוי מפורש.

**למה נמנענו מ־auto-sync:** סנכרון אוטומטי של כל תווית פלייליסט לקטלוג היה **מזהם את האמת הגלובלית** בתוויות זמניות, ספציפיות־דייר, או שלא תואמות slug במילון — ומסיכן את איכות החיפוש לכל הלקוחות. הגשר הוא **מכוון, ממוסגר, וברשימת הרשאה (allowlist)**.

---

## 3. Current architecture overview

### ישויות עיקריות

- **Source** — רשומת URL במסגרת workspace (מקורות הספרייה התפעוליים).
- **Playlist** — פלייליסט של הדייר כולל מטא־דאטה תפעולית (genre, useCases, mood, energy וכו׳).
- **PlaylistItem** — רצועה בתוך פלייליסט; יכולה לצבוע `sourceId` ו/או `catalogId` (קישור אופציונלי לקטלוג גלובלי).
- **CatalogItem** — זהות קנונית גלובלית לפי URL (ללא `workspaceId`).
- **MusicTaxonomyTag** — מילון פלטפורמה (slug, קטגוריה, תוויות EN/HE, סטטוס).
- **CatalogItemTaxonomyTag** — **שכבת האינטליגנציה של DJ Creator לטקסונומיה**: קישור מפורש בין פריט קטלוג לתג במילון, כולל provenance בסיסי (`CatalogItemTaxonomyTagSource`; כיום רק `MANUAL`).
- **DJ Creator search** — לקוח קורא ל־`GET /api/catalog/smart-search` עם פרמטרים (`q`, `daypart`, `avoidSlugs`, מפתח הקשר DJ `djCx`).
- **Playlist metadata registry** — מילולי אחיד לערכים שנשמרים על הפלייליסט (`lib/playlist-metadata-registry.ts`).
- **Smart search** — אורקסטרציה שקוראת למנוע fit + פרופיל + כללי יום (ראה `runSmartCatalogSearch`).

### תרשים זרימת נתונים (טקסטואלי)

```
URL ברשימת המקורות / רצועה בפלייליסט
        ↓
CatalogItem (אם אוחסן/קושר — ייחוס גלובלי)
        ↓
CatalogItemTaxonomyTag → MusicTaxonomyTag (המילון)
        ↓
parseSmartCatalogQuery + score-catalog-fit + (אופציונלי) מסני DJ Creator
        ↓
GET /api/catalog/smart-search → תוצאות מדורגות + coverage
        ↓
DJ Creator AI (אשף לקוח) → בחירה / עריכה → POST /api/playlists (שמירת פלייליסט)
        ↓
(אופציונלי, SUPER_ADMIN + allowlist) POST apply-mapped-catalog-taxonomy
        → הוספת תגי קטלוג לפריטים עם catalogId
```

---

## 4. Current data model and what each layer means

- **Source = רשומת URL של tenant/workspace**  
  שדות כמו `tags`, `taxonomyTags` (Json), `metadata` — שכבת מקורות תפעולית; **אינה מחליפה** את טקסונומיית הקטלוג הגלובלית.

- **Playlist = פלייליסט הדייר + מטא־דאטה תפעולית**  
  כולל `primaryGenre`, `subGenres`, `mood`, `energyLevel`, `useCases` / `useCase` (legacy). זה **מועיל לסידור, לתצוגה, ולעתיד להנחיות** — אך **לא אוטומטית “אמת קטלוג”**.

- **PlaylistItem = הרצועה בפלייליסט**  
  הנגינה מבוססת URL; `catalogId` אם קיים מאפשר קישור לזהות גלובלית ולגשר התיוג.

- **CatalogItem = זהות גלובלית קנונית**  
  כולל שדות עריכה, דירוג אוצרות (`curationRating`), אנרגיה ידנית (`manualEnergyRating`), ארכיון (`archivedAt`) וכו׳.

- **MusicTaxonomyTag = מילון הפלטפורמה**  
  שליטה בשפה אחידה (slug), קטגוריה, חיים (ACTIVE/DEPRECATED/…).

- **CatalogItemTaxonomyTag = שכבת האינטליגנציה האמיתית לחיפוש חכם**  
  כאן נשמרים הקישורים שמאפשרים למנוע ה־fit להתאים “מסעדה / בוקר / אנרגיה גבוהה / סגנון…”.

- **Playlist metadata ≠ קטלוג טקסונומי**  
  ערכי הרישום (`playlist-metadata-registry`) **אינם מובטחים** להתאים ל־slugs ב־`MusicTaxonomyTag` בלי מיפוי מפורש.

---

## 5. What DJ Creator AI can already do

מבוסס על קבצים ספציפיים:

- **חיפוש בקטלוג** עם שאילתה טקסטואלית, מיזוג פרופיל `WorkspaceBusinessProfile` כשקיים, ועקיפת daypart (`app/api/catalog/smart-search/route.ts`, `smart-catalog-search.ts`).
- **שימוש בקישורי טקסונומיה** של פריטי קטלוג בתוך דירוג ה־fit (דרך מנוע ה־scoring — לא מפורט כאן שורה־שורה, אך התלות שם בנתוני קטלוג מתויגים).
- **הקשר עסקי מהפרופיל** — סוג עסק, הקהל, אנרגיה, רמזי סגנון, מועדפי daypart (`WorkspaceBusinessProfile` + `buildSmartSearchProfile`).
- **מסנני DJ Creator** — מפתחות מטריצה, רשימת avoid, וסף אנרגיה ידנית (`lib/recommendations/dj-creator-search-context.ts`, שימוש ב־`manualEnergyRating` ב־`smart-catalog-search.ts` בהקשר DJ).
- **יצירה/המשך זרימת אשף** — בחירות “בועות” ומילוי טקסט חופשי, שליפת תוצאות (`components/dj-creator-ai-shell.tsx`).
- **שמירת פלייליסט** — `POST /api/playlists` ואימות (`components/dj-creator-ai-shell.tsx`).
- **Fallback לעורך אנושי** — רישום שורות ל־NDJSON תחת `data/dj-creator-editor-requests.ndjson` (`app/api/dj-creator/editor-request/route.ts`).
- **Hub לפלייליסטים שנשמרו מ־DJ Creator** — `components/dj-creator-hub-panel.tsx`.
- **שימוש בעקיפין במטא־דאטה של פלייליסט להחלת תגים גלובליים** — רק אם SUPER_ADMIN מפעיל את הגשר ורק לפי allowlist (`apply-mapped-catalog-taxonomy/route.ts`).

---

## 6. Strengths of the current feature

סקירה ארכיטקטונית/מוצרית:

1. **הפרדה נקייה** בין מטא־דאטה תפעולית של דייר (`Playlist`/registry) לבין **אינטליגנציה גלובלית** (`CatalogItemTaxonomyTag`).
2. **ממשל קטלוג בטוח יותר** — תיוג גלובלי מכוון, עם מסלולי אדמין ויכולת ארכוב (`archivedAt` על `CatalogItem`).
3. **אין זיהום אוטומטי** של התגים הגלובליים מתוויות פלייליסט אקראיות.
4. **פוטנציאל דה־דופ גלובלי** סביב `CatalogItem.url` / `canonicalUrl` (כפי שמוגדר בסכימה).
5. **בסיס חיפוש טקסונומי** — המילון + הקישורים מאפשרים הרחבת כללי fit ושיפור איכות שאילתא עם הזמן.
6. **גשר אדיטיבי** — endpoint שלא דורס פלייליסט; רק מוסיף קישורי קטלוג־טקסונומיה כשהתנאים מתקיימים.
7. **SUPER_ADMIN-only** לגשר — הפחתת סיכון הפצת תגים שגויים לכל הפלטפורמה.
8. **אין שינוי מכוון בהתנהגות שמירת פלייליסט** במסגרת המשימה (הגשר נפרד משמירת פלייליסט).
9. **הרחבה עתידית ל־AI** — נקודת אמת אחת לפריט + מילון מוסכם + provenance = בסיס טוב למודלים ולמשוב.

---

## 7. Important discovery: playlist tags are not the same as AI catalog tags

**מה נשמר איפה:**

- `Playlist.subGenres`, `useCases`, `mood`, `energyLevel`, `primaryGenre` נשמרים ב־DB/JSON הפלייליסט (`Playlist`, `edit-playlist-form`, `playlist-types`).
- DJ Creator Smart Search מחשב התאמות מבוססות כללים על **תגי הקטלוג** שמקושרים ל־`CatalogItem` דרך `CatalogItemTaxonomyTag`.

**מסקנה:** עדכון מטא־דאטה של פלייליסט **לא משנה** את מה שמנוע החיפוש “רואה” בקטלוג, אלא אם:
1. יש `PlaylistItem.catalogId` לרצועות, **ו**
2. מישהו (אדמין) **מרחיב את מילוי התגים** — ידנית או דרך **הגשר המבוקר**.

**למה ההפרדה בריאה ובטוחה:**

- תוויות דייר עשויות להיות **זמניות, שיווקיות, או לא נקיות מבחינת מילון**.
- אסור שהטיוטות התפעוליות של לקוח אחד **ישתלו באמת גלובלית** על מיליוני URLs משותפים.
- נשמרת שליטה אוצרית: **מה נכנס למילון** ו**מה מקושר לפריט**.

---

## 8. New bridge: playlist metadata → catalog taxonomy

| נושא | פירוט |
|------|--------|
| **נתיב** | `POST /api/admin/platform/playlists/[id]/apply-mapped-catalog-taxonomy` |
| **קובץ מיפוי** | `lib/playlist-metadata-catalog-taxonomy-map.ts` — טבלת `PLAYLIST_METADATA_TAXONOMY_BRIDGE_RULES` (allowlist קטן; הרחבה עתידית באותו קובץ) |
| **שער הרשאות** | `getSuperAdminOrNull()` — ללא SUPER_ADMIN מוחזר 403 |
| **רעיון allowlist** | רק התאמות `(field, playlistValue) → taxonomySlug` מוגדרות מראש; כל ערך אחר נרשם ב־`skipped` עם `no_allowlisted_mapping` |
| **מה מוחל** | לכל `catalogItemId` ייחודי שמופיע ב־`PlaylistItem.catalogId`, יוצרים שורות `CatalogItemTaxonomyTag` לכל תג יעד פעיל ב־DB |
| **מה מדולג** | פריטים בלי `catalogId` → מופיעים ב־`missingCatalogIds`; slugs שלא קיימים או לא ACTIVE → `missingTaxonomyTags` |
| **כפולים** | זוגות `(catalogItemId, taxonomyTagId)` שכבר קיימים נאספים ב־`duplicates`; לא נדרסים |
| **מקור (source) בקטלוג** | הקריאה עוברת דרך `addCatalogItemTaxonomyTag` עם `source: "MANUAL"` (`lib/catalog-item-taxonomy-admin.ts`). **אין** כיום ערך enum נפרד כמו `PLAYLIST_BRIDGE` — **צריך אימות נוסף** אם בפרודקשן נדרש אודיט מובחן. |
| **למה אין migration “גדול”** | המוצר בחר **נתיב מבוקר** מדרגי במקום backfill גורף שמסנכרן תגים שגויים |
| **Source נשאר MANUAL** | בהתאם לקוד: פעולת הגשר משתמשת בערך enum הקיים בלבד |
| **מה חסר ב־UI** | אין כפתור אדמין ל־Preview/Apply במסמך המשתמש — רק API (ראה סעיף 9) |

דוגמאות למיפויים הקיימים ב־allowlist (נבדק בקוד): `progressive-house`, `afro-house`; use cases כמו `gym`, `retail`→`retail-store`, `peak`→`peak-hours`, `warmup`→`warm-up`; `energyLevel` `high`/`low` → `high-energy`/`low-energy`.

---

## 9. What is still weak / missing

תיאור כנה ומעשי:

- **אין כפתור/מסך אדמין** (נכון לבדיקת הקוד) ל־Preview / Apply של הגשר מתוך UI — רק קריאת API.
- **אין `CatalogItemTaxonomyTagSource.PLAYLIST_BRIDGE`** — איבוד provenance מפורש לתיוגים שמקורם בגשר.
- **אין לedge מלא של URL intake/history** כמוצר בשל; `DiscoverySubmission` קיים כ־scaffolding ב־`schema.prisma` עם הערות “שלב 0”.
- **`Source.tags` / שדות Json** לא מחוברים היטב לעריכה אחידה או ל־DJ Creator כמקור החלטה.
- **מטא־דאטה של פלייליסט לא משפיעה אוטומטית** על החיפוש החכם בלי הגשר או בלי להזין את אותם רמזים ידנית בשאילתה/פרופיל.
- **חלק מה־`PlaylistItem` ללא `catalogId`** — הגשר לא יכול להחיל עליהם תגים גלובליים.
- **טבלת המיפוי קטנה** — דורשת הרחבה שיטתית (ומילוי מילון).
- **איכות smart search תלויה בכיסוי קטלוג** — פריטים לא מתויגים או חלשים → תוצאות חלשות.
- **אין תור ביקורת מלא (review queue) מוצרי** לתיוגים; יש fallback NDJSON לעורך ב־DJ Creator.
- **Guest Link / My Link** עדיין לא בשסתום ingestion לקטלוג: Guest שולח המלצה ב־WS (`app/guest/page.tsx`, `server/index.ts`); My Link ב־מובייל מסומן כ־placeholder (“Coming soon”).
- **אין ציון איכות/ביטחון אוטומטי לתגים** (שדה `confidence` קיים בסכימה אך לא כזרימת מוצר מלאה).
- **אין human-in-the-loop ממשי** (אישור אוצר → החלה) מעבר לנתיבי SUPER_ADMIN הקיימים.

---

## 10. Risks to avoid

1. **לא** לסנכרן אוטומטית כל תג פלייליסט ל־`CatalogItemTaxonomyTag`.
2. **לא** לזהם את הקטלוג הגלובלי בתוויות ספציפיות־דייר או זמניות.
3. **לא** לשבור נגינה — כל שינוי בקטלוג/DJ צריך להישאר מנותק מעומס הֹ־player (לפי הכללים שהוגדרו במשימה).
4. **לא** לשנות באקראי את לוגיקת שמירת הפלייליסט.
5. **לא** לערבב ללא כללים: `Source.tags`, מטא־דאטה של `Playlist`, ו־`CatalogItemTaxonomyTag`.
6. **לא** להניח שכל ערך ב־registry תואם slug קיים במילון.
7. **לא** לכתוב תגים גלובליים בלי ממשל (הרשאה + מקור + אולי audit).

---

## 11. What is needed for DJ Creator AI to become better than a human music editor

### 1. Rich catalog coverage
- כל URL נגנים שאפשר מחובר ל־`CatalogItem`.
- לכל פריט קטלוג: כיסוי טקסונומיה מלא לפי מדיניות readiness.
- צילומי מטא (`CatalogSourceSnapshot`) ואותות איכות מספק.

### 2. Better taxonomy
- צירים: ז׳אנר, תת־ז׳אנר, mood, אנרגיה, סוג עסק, יום/שעה, סוג קהל, שפה/תרבות, הקשר מקומי (ישראל), ניקיון/מפורשות, use case לאירועים.

### 3. AI scoring engine
- התאמה לפרופיל עסק, daypart, עקומת אנרגיה, מניעת חזרתיות, מעברי מצב, איזון מוכר/חדש, warmup/peak/cooldown, התנהגות קהל.

### 4. Feedback loop
- מה נוגן, דילוגים, overrides, שמירות, שימוש לפי סניף/עסק, העדפות לקוח, פלייליסטים מצליחים לפי סוג עסק.

### 5. Human-in-the-loop governance
- אישור SUPER_ADMIN/אוצר, תור ביקורת, ציון ביטחון, תיקון תגים שגויים, הרחבת מיפויים.

### 6. Playlist intelligence
- לא רק “למצוא שירים” אלא **רצף**: התקדמות אנרגיה, סגנונות תואמים, מעברי vibe, לוגיקת בלוקי זמן, מניעת “מתים” ברצף.

### 7. Operational product layer
- תצוגה מקדימה, הסבר “למה נבחר השיר”, עריכה, החלת תגים, שמירה, תזמון, למידה משימוש.

---

## 12. Recommended roadmap from here

**שלב 1 — Make the bridge usable**  
UI אדמין: Preview מיפוי → Apply; הצגת `missingCatalogIds`, `duplicates`, `missingTaxonomyTags`.

**שלב 2 — Improve catalog coverage**  
backfill בטוח ל־`catalogId` ל־`PlaylistItem`; דשבורד “לא מקושרים”.

**שלב 3 — Expand taxonomy mapping**  
הרחבת `PLAYLIST_METADATA_TAXONOMY_BRIDGE_RULES` + עדכון המילון.

**שלב 4 — Add provenance and governance**  
migration ל־`PLAYLIST_BRIDGE` (או שם דומה), confidence, review queue, audit log.

**שלב 5 — Improve DJ Creator intelligence**  
שיפורי scoring (מחוץ להיקף “אל תיגע ב-smart search scoring” בזמן עבודות אחרות), משקלי פרופיל עסק, daypart, בונה עקומת אנרגיה, מנוע רצף.

**שלב 6 — Connect future intake sources**  
Guest Link, My Link, URLs עצמיים/מנויים, ledger.

**שלב 7 — Product polish**  
Explainability, יצירת פלייליסט בקליק, אינטגרציה לתזמון, אופטימיזציה פר־סניף.

---

## 13. Exact files and responsibilities

| File | Purpose | Role in feature | Risk level |
|------|---------|-----------------|------------|
| `prisma/schema.prisma` | מודל נתונים מלא | מקור אמת DB לקטלוג, טקסונומיה, פלייליסט, GuestSession, AiDjSession | גבוהה (שינוי דורש migration) |
| `lib/playlist-metadata-registry.ts` | אוצר מילולי פלייליסט | ערכי UI/שמירה לדייר | בינונית |
| `lib/playlist-types.ts` | טיפוסים + `effectivePlaylistUseCases` | גישור לגשר ול־API | בינונית |
| `lib/playlist-metadata-catalog-taxonomy-map.ts` | allowlist מיפוי | ליבת הגשר | בינונית (טעות מיפוי = תיוג שגוי) |
| `app/api/admin/platform/playlists/[id]/apply-mapped-catalog-taxonomy/route.ts` | POST גשר | החלת תגי קטלוג | גבוהה (גלובלי, SUPER_ADMIN) |
| `lib/catalog-item-taxonomy-admin.ts` | CRUD קישורי טקסונומיה | יצירת קישורים (MANUAL) | גבוהה |
| `app/api/catalog/smart-search/route.ts` | Smart search API | DJ Creator + אדמין | בינונית–גבוהה |
| `lib/recommendations/smart-catalog-search.ts` | אורקסטרציה | ליבת החיפוש | גבוהה |
| `lib/recommendations/parse-smart-catalog-query.ts` | פירוש שאילתה | איכות תוצאות | בינונית–גבוהה |
| `lib/recommendations/score-catalog-fit.ts` | דירוג fit | איכות תוצאות | גבוהה |
| `lib/recommendations/dj-creator-search-context.ts` | הקשר DJ ↔ פרמטרי חיפוש | סינון/אנרגיה | בינונית |
| `lib/recommendations/dj-creator-rules.ts` (+ types/json) | חוקי אשף | התאמת טקסט/Matrix | בינונית |
| `lib/recommendations/dj-creator-coverage.ts` | tier כיסוי | UX DJ Creator | נמוכה–בינונית |
| `lib/recommendations/catalog-item-readiness.ts` | שער מוכנות | איכות קטלוג | נמוכה (pure) |
| `lib/recommendations/catalog-item-eligibility.ts` | נגזרת שימוש | מי יכול ב־DJ/search | נמוכה (pure) |
| `lib/catalog-discovery-scope.ts` | סינון `archivedAt` | תחום פריטים פעילים | נמוכה |
| `components/dj-creator-ai-shell.tsx` | אשף לקוח | חוויית DJ Creator | בינונית |
| `components/dj-creator-hub-panel.tsx` | Hub פלייליסטים | ניווט/תצוגה | נמוכה |
| `app/api/dj-creator/editor-request/route.ts` | תור עורך NDJSON | fallback אנושי | נמוכה |
| `components/edit-playlist-form.tsx` | עריכת מטא פלייליסט | שכבת דייר | בינונית |
| `app/admin/platform/catalog-tagging/page.tsx` | עריכת תגים | ממשל קטלוג | גבוהה |
| `app/admin/platform/catalog-coverage/page.tsx` | דשבורד כיסוי | תפעול | בינונית |
| `app/admin/platform/smart-search/page.tsx` | כלי אדמין לחיפוש | בדיקות | נמוכה |
| `app/admin/platform/music-taxonomy/page.tsx` | מילון | ממשל מילולי | גבוהה |
| `app/guest/page.tsx` | טופס אורח | עתידי ל-ingestion | נמוכה (לא קטלוג מלא) |
| `server/index.ts` | WS Guest recommend | אינטגרציה עתידית | בינונית |
| `prisma/seed-data/music-taxonomy.generated.json` | זרע טקסונומיה | בסיס מילון | בינונית |

---

## 14. Final recommendation

**הצעד הבא המומלץ: A — UI לגשר (Preview + Apply + שקיפות חוסרים/כפולים).**

**למה:** הגשר (`apply-mapped-catalog-taxonomy`) כבר קיים, מוגן ב־SUPER_ADMIN, ומדווח מפורשות על `missingCatalogIds`, `duplicates`, `missingTaxonomyTags`, ו־`skipped`. בלי UI, היכולת הזו כמעט לא נגישה למפעילים — ולכן **אינה מייצרת ערך קטלוגי** בקצב שצריך. זה גם בונה את שכבת האמון לפני backfill של `catalogId` (שלב 2 ברודמאפ): כשהמפעיל רואה במסך מי חסר קישור לקטלוג, אפשר לתכנן backfill בטוח יותר.

**מה לא לבחור עכשיו כעיקרי:** Guest Link (D) או ledger (E) לפני שניתן **לייעל את המחזור האדמין-אנושי** סביב הגשר והכיסוי — אחרת מזרימים עוד כניסות בלי ממשק גיבוי מסודר.

---

## נספח: החזרה למזמין המסמך

1. **מסמך:** `docs/DJ_CREATOR_CATALOG_CURRENT_STATE_AND_VISION.md`  
2. **סיכום קצר:** נבנה כיוון **catalog-first** עם טקסונומיה גלובלית, חיפוש חכם, DJ Creator V1, וגשר מבוקר ממטא־דאטה פלייליסט לתגי קטלוג (SUPER_ADMIN + allowlist).  
3. **Top 5 strengths:** הפרדת דייר/גלובל; גשר לא מזהם; בסיס מילון+קישורים; smart search end-to-end; מוכנות/זכאות פריט לניהול איכות.  
4. **Top 5 gaps:** אין UI לגשר; מיפוי קטן; חוסר `catalogId` בחלק מהפריטים; אין provenance מובחן לגשר; Guest/My Link מחוץ לצינור קטלוג עמיד.  
5. **Next step:** **A — UI לגשר** (Preview/Apply + שקיפות).  
6. **שינוי קוד מעבר למסמך:** **לא** — נוצר/עודכן רק קובץ התיעוד הזה.

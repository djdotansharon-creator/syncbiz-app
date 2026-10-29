# Handoff — for the Claude that has Railway / database access (written 2026-10-29)

You are picking this up from another Claude session that **could not** reach Railway or the PROD database. The owner (Dotan — a product owner, **not a programmer**, writes in Hebrew, wants short plain answers, one decision at a time) asked for this note so that the part that needs Railway can be done by someone who has it. Read `CLAUDE.md` first (the engineering constitution — binding), then `docs/VONO_PILOT_BASELINE.md`. Product name is **VONO**; the repo, packages and many identifiers still say **SyncBiz** — same product.

## 1. What the product is, in one paragraph
VONO controls music / announcements for business branches. A branch has a **Player** (a computer that plays: the VONO desktop app on the station, or — in the loosely-managed legacy case — a browser tab) and any number of **Remotes** (browsers / phones that control it). The Next.js app (`app/`, `lib/`, `components/`) is UI + REST; a separate WebSocket server (`server/`) routes commands; Electron (`desktop/`) hosts the player with MPV. PostgreSQL via Prisma. Railway project **`focused-exploration`** (PROD) has two services: `syncbiz-app` and `syncbiz-ws`; **TEST** is a separate project (`syncbiz-pr52-test`). **A Railway deploy does NOT run migrations** (`start` = `next start`). Hard rules that matter here: the designated station is the playback authority (CLAUDE.md §11), local file paths never leave the machine (§12), music must never stop (§14, quality bar), TEST and PROD stay separate (§10), no force-push, no `desktop-v*` tags.

## 2. How the owner wants the whole thing to work (his plan — please stay faithful to it)
His own words are in Appendix A (Hebrew, verbatim excerpts). The shape:

1. **Every person has their own account.** No shared owner login. Sign-up = personal details, then **two choices: "set up a new business" or "join an existing business"**. New business → business questions → **pays for the first Player** (Remotes are free and unlimited; a business pays per Player computer). Joining → a **one-time code or QR** made by a manager; the joiner appears as a **request** (red circle) to the owner, who approves and **picks the person's role**.
2. **Roles are defined by the business owner**, each with switches, including **"may sign in from a computer"** (a worker who only needs the phone must not be able to log in from a home PC). Typical: manager, shift manager, employee, partner.
3. **Devices are approved too** (Player or Remote), the same way: a new device asks, the owner approves; computers that are Players are numbered by the paid allocation; **the owner's own computer is the normal interface, can play, and does not use a seat.**
4. **A computer defined as a branch's Player is the ONLY possible Player of that branch.** If it is off, a Remote must **not** quietly become the Player (the legacy 90-second auto-promotion does that today for non-designated branches — it is exactly what confused the owner). Changing the Player is an explicit, audited admin action. (Not built yet — it touches MASTER logic; see §5.)
5. **The control screen is a separate plain-black screen**, not part of the player: Control Room, Dashboard, Permissions (+Display screen), Settings — one row of icon + word buttons. A **corner button** (start edge: right in Hebrew, left in English) goes to the live player and an icon in the player's corner comes back — **no code between them**. A **Remote computer opens on the control screen**. On the **Player computer** the same screen sits behind the **gear** and a **code the owner chooses** (it is `123` until he does).
6. **Free listening:** only the paying account's owner may have a free Player **on a phone**, **one phone at a time** (so people do not stream the owner's account in their own shop over Bluetooth). A computer that is a Remote cannot play. **Not built yet** (phone UI is a later phase).
7. Visual rules: no frames around icons, soft glass, plain black for management screens, nothing that risks playback.

## 3. What is already merged to `main` (all UI/server changes are additive)
`main` = **`41bcd3d`** (deployed on PROD 2026-10-29 ~22:43 — `GET /api/join/config` and `GET /api/roles` both answer `enabled:false`). Earlier live states: `198ef02`, `f8c19fe`. Previous known states: `955855f` (before accounts work), `9f15c1a`, `df9b703`.

| Feature | PRs | State on PROD |
|---|---|---|
| Device approval ("enrollment"): Player / Remote requests, hold screen, Control Room tile + red circle, signed role in the WS token | #72, #73 (+ docs #71 **not merged**) | **dormant** — needs migration + env flag + workspace switch |
| UI polish: albums, library cards, sign-in pages, info icon, Jingles/lock-screen keep the socket | #78–#80 | live |
| **Join a business by a one-time code** (sign-up in steps, "People joining" panel in Access Control) | #81 | **dormant** — needs migration + env flag |
| **Control screen** (separate black screen, corner button, Settings out of the rails workspace, Remote lands on it) | #82 | live (the Remote landing needs enrollment on) |
| **Access code for Settings on the Player computer** (desktop app only; `123`) | #83 | live; browsers are never locked |
| **Roles with switches + the owner's own access code** (panel "Roles" in Access Control; pick a role when approving a joiner; a role can forbid signing in from a computer) | #85 | **dormant** — needs migration + `SYNCBIZ_ROLES=1` |
| `build` script retries `next build` up to 3× (Google Fonts fetch flake) | #86 | live |

Design docs: `docs/DEVICE_ENROLLMENT_DESIGN.md`, `docs/DEVICE_ENROLLMENT_ROLLBACK.md`, `docs/ACCOUNTS_JOIN_DESIGN.md`, `docs/CONTROL_SCREEN_DESIGN.md`.

## 4. YOUR TASK — turn the dormant features on for the OWNER'S workspace only (PROD)
The owner approved this explicitly on 2026-10-29, **including that the father's computer may get stuck on the request screen until approved** ("no problem"). Do it with the owner present so he can approve the first requests at once.

**Why migrations are needed:** five migrations create **new tables only** (no existing table changes), so deploys before them were safe; the features need them before being switched on.

1. **Back up** the PROD database (Railway → Postgres → Backups, or `pg_dump`). Note the Railway deployment ID currently live for `syncbiz-app` (rollback reference).
2. **Check what is pending:**
   `SYNCBIZ_ALLOW_PROD_DB=1 DATABASE_URL="<PROD public URL>" npx prisma migrate status`
   Expect these five pending (and nothing else): `20261027161357_device_enrollment`, `20261028120000_device_enrollment_requester`, `20261028180000_device_enrollment_branch_details`, `20261029120000_join_by_code`, `20261029200000_roles`. If anything else is pending or the status shows drift — **stop and ask the owner**.
3. **Apply:** `SYNCBIZ_ALLOW_PROD_DB=1 DATABASE_URL="<PROD public URL>" npx prisma migrate deploy` (the guard `scripts/prisma-safe.mjs` refuses a non-local target without `SYNCBIZ_ALLOW_PROD_DB=1`; that is intentional). Then `migrate status` must say up to date. Never print or store the URL in a file, doc or commit.
4. **Environment variables on the `syncbiz-app` service** (Railway → Variables), then redeploy:
   - `SYNCBIZ_DEVICE_ENROLLMENT=1`
   - `SYNCBIZ_JOIN_BY_CODE=1`
   - `SYNCBIZ_ROLES=1`
   - optional: `SYNCBIZ_MANAGEMENT_CODE=<3+ chars>` (otherwise the Player-computer access code is `123`)
   The `syncbiz-ws` service needs no new variable (the role travels as a signed claim in the token; it already knows `SYNCBIZ_WS_SECRET`).
5. **Switch device approval on for the owner's workspace only:** sign in as the owner on PROD → Control Room → the first tile "New requests" (plus + red count) → the switch. This automatically approves every existing **station** and the **owner's own computer** (normal interface, can play, no seat). Anything else — e.g. the father's browser — becomes a pending request: approve it (as **Player** if it plays music) right away from the owner's computer.
6. **Verify (and tell the owner what you saw):** (a) the owner's computer still works and can play; (b) the father's computer asks, and plays again after approval; (c) a second browser profile shows the request screen with only the two big icons (Player / Remote) and, once approved as Remote, **opens on the control screen**; (d) `/api/join/config` → `{"enabled":true}` and `/api/roles` (signed in as the owner) lists Manager / Shift manager / Employee; sign-up page shows the "new business / join" step; Access Control shows **People joining** and can make a one-time code; (e) the Lenovo pilot station is **not** affected (it is pinned to TEST — do not touch it).
7. **Roll back** if anything is wrong: remove `SYNCBIZ_DEVICE_ENROLLMENT` / `SYNCBIZ_JOIN_BY_CODE` and redeploy (instant, no data loss), or switch the workspace off in the panel. Full table in `docs/DEVICE_ENROLLMENT_ROLLBACK.md` and `docs/ACCOUNTS_JOIN_DESIGN.md`.

**Do not enable these for any real customer yet** — see "known gaps" (the data routes still answer to a session cookie; the planned per-device credential, design Phase 4a, must land first).

## 5. What the other Claude is building next (do not duplicate; it will merge to `main` as dormant PRs)
- Changing the role of an EXISTING member from the Roles screen (roles are assigned at approval today).
- Red circle for waiting people on the Control Room, role-based landing.
- Later, **only with the owner's explicit yes and a Lenovo-class regression on TEST first**: "a branch with an approved Player has no auto-promotion of a Remote" (MASTER logic), the free phone Player rules, payment (provider not chosen — owner said drop it for now).

## 6. Known gaps (written down on purpose)
- **Data routes:** device approval is enforced at the client hold and the WS token, not on every REST data route (a signed-in person with a not-approved device could still call the REST API directly). Fix = revocable per-device credential (design Phase 4a). Fine for the owner's own workspace; required before a real customer.
- Join-by-code has **no e-mail verification** (the approver vouches for the person) and no QR yet.
- Payment is not connected (no provider chosen).
- `next build` intermittently fails fetching Google Fonts (`next/font/google queries have exactly one entry`); the build script now retries 3×. Longer-term: self-host the fonts (`next/font/local`).
- Railway has twice produced deployments reported as "failed" / no deployment at all for merges that build and boot cleanly from a fresh checkout (verified 2026-10-29: `npm ci` + `next build` with no env files, then `next start`). If a deploy does not appear or fails, look at the Railway build log — the cause was not in the code. A later redeploy of `198ef02` succeeded.

## Appendix A — the owner's brief (verbatim excerpts, Hebrew; "[...]" marks what was left out), 2026-10-29
> אני רוצה בתור המעצב של החווית משתמש וממשק לשנות את כל המערך שליטה על העסק. [...] קודם כל אנחנו נשנה את זה שכולם תחת אותו מייל וססמה כי זה לא יגמר לעולם. יש לנו בן עובד חדש שיצור לעצמו משתמש. אם אני מנהל של שופרסל ויש לי סניף שיש לו שם מנהל שהנגן יהיה תחת המייל שלו למה תחת שלי? ואם אני גם הבעלים נוח לי יותר להתחבר תחת המייל שלי ולא של כל שופרסל... ובנוסף לזה באימות דו שלבי המייל של שופרסל סתם יהיה מפוצץ שהודעות ולא לכולם יש גישה אליו.
>
> אז דבר ראשון יש לך התחברות או יצירת משתמש. ברגע שאני התחברי החשבון שלי כבר עם ההגדרות שהיו לפני ומתקדמים כרגיל. אם אני חדש ואני יוצר חשבון בוא נעשה תהליך [...] שם, מייל, סיסמה, טלפון [...] אחרי זה אני רוצה שני ריבועים תכלס. עסק חדש או עסק קיים [...]
>
> אם זה עסק חדש יהיו סדר השאלות של שם עסק, איך העסק מתנהל [...] ואז יהיה הקטע של התשלום תחת כמה נגנים הבן אדם צריך [...] שלטים רחוקים כרגע נתן בלי הגבלה בחינם ובהמשך [...] ואז הוא יקבל את המסך של הבעלים של העסק [...] ואז החשבון הזה מוגדר בתור החשבון מנהל.
>
> עכשיו כל עובד שמצתוות תחת העסק החדש והבעלים רוצה לתת לו גישות מסויימות. כמו מנהל סניף, מנהל משמרת, עובד וכל אחד עם ההרשאות שלו הוא ילחץ על הכפתור שני מתחבר לעסק קיים. ושם [...] להכניס קוד חד פעמי. שמי שיצור אותו זה המנהל [...] יצירת קוד התחברות או סריקת ברקוד [...] אם זה qr אז ישר יפתח חשבון איפיון לבעלים של העסק. אם זה קוד יש יופיע באנשים התראה בעיגול או משהו והוא יראה הבעלים באזור של האנשים שיש בקשה חדשה. ואז כשהו ילחץ יהיה לו אפייון עובד. באיפיון עובד הוא יצטרך להחליט את הrole שהוא נותן לבן אדם מתוך הroles שהוא הגדיר לעסק בפתיחה שלו [...] מנהל משמרת או מה שהוא הגדיר אולי אפילו שותף... ילחץ אישור וזהו הבן יקבל גישה למערכת עם ההגבלות שנתנו לו תחת העסק הקיים.
>
> עכשיו נגיד ואני הבעלים ופתחתי את הסניף וקניתי לו טבלט שיהיה הנגן בסניף או מחשב קיים. אני מוריד את האפליקציה. [...] יהיה התחברות או נגן. אם זה נגן יהיה ישר קוד או סריקת qr זה יהיה תחת קטגוריית נגנים אצל החשבון של הבעלים הוא יעשה בדיוק כמו בעובד חדש רק תחת נגנים. ואם אני פשוט רוצה להתחבר יהיה לי התחברות אבל בתכלס אני לא רוצה שעכשיו עובד שיש לו גישה לנגן יכול להכנס מהמחשב בבית שלו כי אין מה. אני רוצה שבכל role יהיה אפשרות לאפשר כניסה ממחשב. למה? כי אם עכשיו יש את רשת שופרסל תחתיה יש עובדים יש מנהלים ויש עוד המון תפקידים יש אנשים שכן תריכים לקבל גישה לשליטה על הגישות ועל העסקים מרחוק...
>
> עכשיו מי מקבל את הנגן החופשי החינמי שאנחנו נותנים דרך שלט רחוק קודם כל רק דרך טלפון אפשר לנגן ולשמוע מוזיקה חופשי חינם בלי הגדרה של נגן נוסף [...] ומי שיוכל לעשות את זה זה אך ורק מהחשבון שסולק את האשראי. הבעלים של העסק רק הוא יכול לקבל מתנה נגן אישי בטלפון שלו. ורק דרך מכשיר אחד יוכלו לנגן בו זמנית על אותו חשבון (בנגן חינמי בטלפון) כדאי שאנשים לא יתחילו להתחבר לי תחת החשבון של הבעלים ולנגן בעסקים בבלוטוס פשוט...
>
> עכשיו ממשק מחשב שהוא שליטה מרחוק ולא נגן עצמו [...] הוא לא צריך לראות ישר את הנגן עצמו [...] המסך שעכשיו יש הוא לא המושלם כי זה כמו הגדרות שהם לא צריכים להיות בתוך הנגן [...] צריך מסך מלא מסודר נקי [...] כל החדר בקרה יהפוך להיות אזור שלם לא בטאבים [...] למעלה אייקון לנגן [...] ואם אלחץ שוב על האייקון [...] יחזיר אותי למסך שליטה [...] בבקרה יהיה חדר בקרה, לוח בקרה, הרשאות ומסך תצוגה אבל אני רוצה במקום טקסט שיהיה אייקונים [...] (אם רוצים טקסט ליד האייקון אין בעיה).
>
> במחשב של הנגן [...] אני רוצה שכל האזור בקרה והכל יהיה תחת ההגדרות נוספות. [...] טאב אחד נוסף עם אייקון הגדרות [...] בהגדרות נוספות יהיה צריך להכניס קוד שהבעלים יחליט שיהיה [...] וגם יפתח המסך בדיוק כמו שיש בשלט רחוק בחדר בקרה.
>
> ממשק טלפון עוד ניגע בזה עוד לא הגענו לשם.

Follow-ups the same day: **"a computer that is set as a branch's Player is the ONLY possible Player; if it is off, a remote must not become the Player"**; the transition between the control screen and the player is **a corner button, no code**; the access code for More settings is **123** for now; **"turn device approval on — it is fine if my father's computer gets stuck"**; the payment provider question: **"leave it for now"**; he wants the **owner's own computer to stay the normal interface and play, not counted in the allocation**.

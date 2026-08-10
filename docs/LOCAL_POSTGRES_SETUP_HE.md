# הקמת PostgreSQL מקומי לבדיקות (עברית)

מדריך קצר להקמת מסד נתונים **מקומי** על המחשב, לצורך בדיקת ה-migrations וה-backfill של
שכבת המוזיקה האוניברסלית — **בלי לגעת ב-production**.

> 🔒 **בטיחות:** הכל רץ על `localhost` בלבד. הכלים מסרבים לרוץ אם הסביבה אינה `development`
> או אם ה-host אינו מקומי. אף פקודה כאן לא נוגעת ב-DATABASE_URL של הפרודקשן.

---

## מה כבר נבדק
- ❌ PostgreSQL לא מותקן במחשב
- ❌ Docker לא מותקן

לכן צריך התקנה חד-פעמית אחת (PostgreSQL). **אין להתקין דבר בלי אישורך.**

---

## שלב 1 — התקנת PostgreSQL (חד-פעמי)
1. היכנס ל: `https://www.postgresql.org/download/windows/` ולחץ על **"Download the installer"**.
2. הורד את גרסה **16** (או גרסה התואמת ל-production — ראה "איך לבדוק את גרסת הפרודקשן" בסוף).
3. הרץ את הקובץ → **Next** בכל המסכים, ובמסך הסיסמה **בחר סיסמה למשתמש `postgres`**
   (שמור אותה לעצמך — **לא לשלוח לי**). פורט: **5432** (ברירת מחדל). סיים בהתקנה.
4. נותקן גם **pgAdmin** (כלי גרפי) — נשתמש בו בשלב 2.

## שלב 2 — יצירת מסד הנתונים `syncbiz_dev`
**דרך pgAdmin (הכי פשוט):**
1. פתח **pgAdmin** → התחבר עם סיסמת `postgres`.
2. קליק ימני על **Databases** → **Create** → **Database…**
3. בשדה **Database** רשום: `syncbiz_dev` → **Save**.

**או דרך הטרמינל:**
```bash
createdb -U postgres syncbiz_dev
```

## שלב 3 — קובץ ההגדרות המקומי
1. בתיקיית הפרויקט, העתק את `.env.development.example` לקובץ חדש בשם `.env.development`.
2. פתח את `.env.development` והחלף את `REPLACE_WITH_YOUR_LOCAL_PASSWORD` בסיסמת `postgres` שלך.
   השורות אמורות להיראות כך (הסיסמה שלך במקום `xxxx`):
   ```
   DATABASE_URL=postgresql://postgres:xxxx@localhost:5432/syncbiz_dev
   SYNCBIZ_ENV=development
   ```
   > הקובץ `.env.development` נשאר אצלך בלבד ולא נכנס ל-git.

## שלב 4 — בדיקת בטיחות (חובה לפני כל דבר אחר)
הרץ:
```bash
npm run db:check
```
הפקודה **לא מתחברת** למסד — היא רק בודקת שההגדרות נכונות ומדפיסה את היעד (בלי סיסמה).
פלט תקין:
```
[target] env=development host=localhost port=5432 db=syncbiz_dev user=p***
✓ OK — local dev target is safe (env=development, host=localhost, db=syncbiz_dev, NOT production).
```
אם מופיע `✗ FAILED` — תקן את `.env.development` (בדרך כלל host שאינו `localhost` או db שאינו `syncbiz_dev`).

## שלב 5 — הודע לי "מוכן"
לאחר ש-`npm run db:check` מציג `✓ OK`, הודע לי. אז — **באישורך** — אריץ (מול המסד המקומי בלבד):
1. `prisma migrate deploy` → יצירת כל הטבלאות.
2. `backfill` ב-**dry-run** → דוח בלי לכתוב.
3. סקירה → `--apply` → אימות → `--rollback --apply` (הוכחת הפיכות).

---

## איך לבדוק את גרסת הפרודקשן (בלי לגעת בנתונים)
בדשבורד של Railway → שירות ה-Postgres → לשונית **Deployments/Logs** או **Connect** — הגרסה
מופיעה שם (למשל `PostgreSQL 16`). זו קריאה בלבד; אין להריץ שאילתות. התקן מקומית את אותה
גרסה ראשית (major).

## פתרון בעיות
- `psql: command not found` → פתח חלון PowerShell **חדש** אחרי ההתקנה (כדי לטעון PATH).
- `db:check` מראה `host=127.0.0.1` → שנה ל-`localhost` בקובץ.
- שכחת אם המסד נוצר → ב-pgAdmin תראה `syncbiz_dev` תחת Databases.

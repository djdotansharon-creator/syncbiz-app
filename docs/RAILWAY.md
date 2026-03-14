# Railway Deployment – Persistent Data

## בעיה: פלייליסטים ורדיו נמחקים

בלי Volume, הקבצים נכתבים ל-filesystem זמני ונמחקים ב-redeploy או בין בקשות.

## פתרון: הוספת Volume

1. **ב-Railway Dashboard:** לחץ `Ctrl+K` (Command Palette)
2. **בחר:** "Add Volume" או "Create Volume"
3. **בחר את השירות** (syncbiz-app)
4. **הגדר Mount Path:** `/app/data`
5. **שמור** – Railway יגדיר אוטומטית `RAILWAY_VOLUME_MOUNT_PATH`

אחרי הוספת ה-Volume, פלייליסטים ותחנות רדיו יישמרו גם אחרי ניווט ו-redeploy.

## הרשאות (אם יש שגיאות כתיבה)

אם מופיעות שגיאות הרשאה, הוסף משתנה סביבה:

```
RAILWAY_RUN_UID=0
```

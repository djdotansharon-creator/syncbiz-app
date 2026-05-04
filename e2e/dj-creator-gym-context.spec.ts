import { execSync } from "node:child_process";
import { test, expect } from "@playwright/test";

const BANNED_STYLE = /\b(jazz|bossa|lounge|acoustic|smooth\s*jazz|soft\s*jazz)\b/i;
const BANNED_STYLE_INSTRUMENTAL = /\binstrumental\b/i; // only as primary style option label

/** `GET /api/playlists/[id]` (not metadata/play/refresh sub-resources). */
function isPlaylistDocumentGet(urlStr: string): boolean {
  const pathOnly = urlStr.split(/[?#]/)[0];
  const m = pathOnly.match(/\/api\/playlists\/([^/]+)\/?$/);
  if (!m) return false;
  const segment = decodeURIComponent(m[1]);
  if (/^(metadata|play)$/i.test(segment)) return false;
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const plPrefixed = /^pl-[0-9a-f-]{10,}$/i;
  return uuidLike.test(segment) || plPrefixed.test(segment);
}

/** POST create list root only. */
function isPlaylistCreatePost(urlStr: string): boolean {
  const u = urlStr.split(/[?#]/)[0].replace(/\/+$/, "");
  return /\/api\/playlists$/i.test(u);
}

async function loginWithSeedFallback(page: import("@playwright/test").Page) {
  try {
    await login(page);
  } catch {
    execSync("npx tsx scripts/seed-e2e-user.ts --confirm-local-e2e", {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    });
    await login(page);
  }
}

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login", { waitUntil: "networkidle", timeout: 120_000 });
  await expect(page.locator("#email")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: /Continue to dashboard|Signing in/i })).toBeEnabled({
    timeout: 60_000,
  });

  await page.locator("#email").fill("test@syncbiz.com");
  await page.locator("#password").fill("test123");

  const loginResponsePromise = page.waitForResponse(
    (r) => r.url().includes("/api/auth/login") && r.request().method() === "POST",
    { timeout: 60_000 },
  );
  await page.getByRole("button", { name: /Continue to dashboard/i }).click();
  const loginRes = await loginResponsePromise;
  if (!loginRes.ok()) {
    const body = await loginRes.text().catch(() => "");
    throw new Error(`[E2E auth] POST /api/auth/login returned ${loginRes.status()} ${body.slice(0, 500)}`);
  }

  await page.waitForURL(/\/(dashboard|sources|library|mobile)/, { timeout: 60_000 });
}

async function openDjAssistant(page: import("@playwright/test").Page) {
  await page.goto("/sources");
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: /Open assistant|פתיחת העוזר/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
}

/** Wizard option buttons: the grid after the welcome thread (not header/footer). */
function wizardOptionButtons(dialog: ReturnType<import("@playwright/test").Page["locator"]>) {
  return dialog.locator('[class*="grid-cols-1"][class*="gap-2"]').first().locator("button");
}

async function readOptionLabels(dialog: ReturnType<import("@playwright/test").Page["locator"]>) {
  const btns = wizardOptionButtons(dialog);
  await expect(btns.first()).toBeVisible({ timeout: 8_000 });
  return btns.allInnerTexts();
}

async function clickFirstMatchingOption(
  dialog: ReturnType<import("@playwright/test").Page["locator"]>,
  pattern: RegExp,
) {
  await wizardOptionButtons(dialog).filter({ hasText: pattern }).first().click();
}

test.describe("DJ Creator AI — Gym contextual (Stage 6.1)", () => {
  test.beforeEach(async ({ page }) => {
    await loginWithSeedFallback(page);
  });

  test("1) Gym → Night → Happy: high-energy styles + intensity final + avoidSlugs on search", async ({
    page,
  }) => {
    let searchUrl = "";
    page.on("request", (req) => {
      const u = req.url();
      if (u.includes("/api/catalog/smart-search")) searchUrl = u;
    });

    await openDjAssistant(page);
    const dialog = page.getByRole("dialog");

    await clickFirstMatchingOption(dialog, /Gym|חדר כושר/i);
    await clickFirstMatchingOption(dialog, /Night|לילה/i);
    await clickFirstMatchingOption(dialog, /Happy|שמח/i);

    const styleLabels = await readOptionLabels(dialog);
    const styleText = styleLabels.join(" | ");
    for (const label of styleLabels) {
      expect.soft(label, `style bubble must not be calm default: ${label}`).not.toMatch(BANNED_STYLE);
      expect.soft(label, `no instrumental as primary style chip: ${label}`).not.toMatch(BANNED_STYLE_INSTRUMENTAL);
    }

    await clickFirstMatchingOption(dialog, /Let DJ Creator|יבחר|לבחור/i);

    const finalLabels = await readOptionLabels(dialog);
    expect(finalLabels.some((t) => /Warmup|חימום/i.test(t))).toBeTruthy();
    expect(finalLabels.some((t) => /Active|פעיל/i.test(t))).toBeTruthy();
    expect(finalLabels.some((t) => /Peak|שיא/i.test(t))).toBeTruthy();
    expect(finalLabels.some((t) => /Mixed|מעורבב/i.test(t))).toBeTruthy();
    expect(dialog.getByText(/How intense|אינטנסיבי/i)).toBeVisible();

    await clickFirstMatchingOption(dialog, /Active|פעיל/i);
    await dialog.getByRole("button", { name: /Get my 10|10 המלצות/i }).click();
    await expect.poll(() => searchUrl.length, { timeout: 25_000 }).toBeGreaterThan(10);
    expect(searchUrl).toMatch(/avoidSlugs=/);
    expect(searchUrl).toMatch(/jazz/);
    expect(searchUrl).toMatch(/bossa-nova|bossa/i);
    expect(searchUrl).toMatch(/lounge/);
  });

  test("2) Gym → Night → High energy: same style guard + intensity", async ({ page }) => {
    await openDjAssistant(page);
    const dialog = page.getByRole("dialog");

    await clickFirstMatchingOption(dialog, /Gym|חדר כושר/i);
    await clickFirstMatchingOption(dialog, /Night|לילה/i);
    await clickFirstMatchingOption(dialog, /High energy|אנרגיה גבוהה/i);

    const styleLabels = await readOptionLabels(dialog);
    for (const label of styleLabels) {
      expect.soft(label).not.toMatch(BANNED_STYLE);
      expect.soft(label).not.toMatch(BANNED_STYLE_INSTRUMENTAL);
    }

    await clickFirstMatchingOption(dialog, /Afro|אפרו/i);
    const finalLabels = await readOptionLabels(dialog);
    expect(finalLabels.join(" ")).toMatch(/Warmup|Active|Peak|Mixed|חימום|פעיל|שיא|מעורבב/);
  });

  test("3) Gym → Evening → High energy: workbook style set (House/EDM etc.)", async ({ page }) => {
    await openDjAssistant(page);
    const dialog = page.getByRole("dialog");

    await clickFirstMatchingOption(dialog, /Gym|חדר כושר/i);
    await clickFirstMatchingOption(dialog, /Evening|ערב/i);
    await clickFirstMatchingOption(dialog, /High energy|אנרגיה גבוהה/i);

    const styleLabels = await readOptionLabels(dialog);
    const joined = styleLabels.join(" ");
    expect(joined).toMatch(/Let DJ Creator|יבחר|לבחור/i);
    expect(joined).toMatch(/Afro|אפרו/i);
    expect(joined).toMatch(/House|EDM|האוס/i);
    expect(joined).toMatch(/Pop|פופ/i);
    expect(joined).toMatch(/Hip Hop|היפ הופ/i);
    expect(joined).toMatch(/Dance|דאנס/i);
    for (const label of styleLabels) {
      expect.soft(label).not.toMatch(BANNED_STYLE);
    }
  });

  test("4) Gym → Afternoon → Happy: not generic STYLE_BUBBLES (has Afro/House path)", async ({
    page,

  }) => {
    await openDjAssistant(page);
    const dialog = page.getByRole("dialog");

    await clickFirstMatchingOption(dialog, /Gym|חדר כושר/i);
    await clickFirstMatchingOption(dialog, /Afternoon|אחר הצהריים/i);
    await clickFirstMatchingOption(dialog, /Happy|שמח/i);

    const styleLabels = await readOptionLabels(dialog);
    const joined = styleLabels.join(" ");
    expect(joined).toMatch(/Afro|אפרו|House|EDM|Pop|Dance/i);
    expect(joined).not.toMatch(/Bossa|בוסה/i);
    expect(joined).not.toMatch(/\bLounge\b|לאונג/i);
  });

  test("5) Hotel → Night → Premium: lounge pathway; V1 skips voc/language → review + composer", async ({
    page,

  }) => {
    await openDjAssistant(page);
    const dialog = page.getByRole("dialog");

    await clickFirstMatchingOption(dialog, /Hotel|מלון/i);
    await clickFirstMatchingOption(dialog, /Night|לילה/i);
    await clickFirstMatchingOption(dialog, /Premium|פרימיום/i);

    const styleLabels = await readOptionLabels(dialog);
    const joined = styleLabels.join(" ");
    expect(joined).toMatch(/Lounge|לאונג|Jazz|ג׳אז|elegant|premium/i);

    await clickFirstMatchingOption(dialog, /Let DJ Creator|יבחר|לבחור/i);

    await expect(dialog.getByPlaceholder(/Type anything|אפשר לכתוב/i)).toBeVisible({ timeout: 8_000 });
    await expect(dialog.getByRole("button", { name: /Get my 10|10 המלצות/i })).toBeVisible();

    const vocalLang = dialog.getByRole("button", {
      name: /Vocals|שירה ושפה|Instrumental|עברית|English|International/i,
    });
    expect(await vocalLang.count()).toBe(0);
  });

  test("6) Cafe → Morning → Calm: calm/cafe options, normal final", async ({ page }) => {
    await openDjAssistant(page);
    const dialog = page.getByRole("dialog");

    await clickFirstMatchingOption(dialog, /Cafe|קפה/i);
    await clickFirstMatchingOption(dialog, /Morning|בוקר/i);
    await clickFirstMatchingOption(dialog, /Calm|רגוע/i);

    const styleLabels = await readOptionLabels(dialog);
    const joined = styleLabels.join(" ");
    expect(joined).toMatch(/Lounge|Bossa|Jazz|auto|יבחר|choose/i);
  });

  test("7) Save Gym draft as playlist: POST ok, no play-now, picks avoid calm tags", async ({ page }) => {
    let playNowHits = 0;
    page.on("request", (req) => {
      if (req.url().includes("/api/play-now")) playNowHits += 1;
    });

    await openDjAssistant(page);
    const mainDialog = page.getByRole("dialog", { name: /DJ Creator AI|יוצר/i });

    await clickFirstMatchingOption(mainDialog, /Gym|חדר כושר/i);
    await clickFirstMatchingOption(mainDialog, /Night|לילה/i);
    await clickFirstMatchingOption(mainDialog, /High energy|אנרגיה גבוהה/i);
    const styleLabels = await readOptionLabels(mainDialog);
    for (const label of styleLabels) {
      expect.soft(label).not.toMatch(BANNED_STYLE);
    }
    await clickFirstMatchingOption(mainDialog, /Afro|אפרו/i);
    await clickFirstMatchingOption(mainDialog, /Active|פעיל/i);
    await mainDialog.getByRole("button", { name: /Get my 10|10 המלצות/i }).click();

    const picks = mainDialog.locator("ul").locator("li");
    await expect(picks.first()).toBeVisible({ timeout: 30_000 });
    const pickTexts = await picks.allInnerTexts();
    const joined = pickTexts.join("\n");
    expect.soft(joined, "draft visible text should not read as calm-jazz lane").not.toMatch(
      /\b(bossa|smooth\s*jazz|soft\s*jazz)\b/i,
    );
    expect.soft(joined).not.toMatch(/\blounge\b[\s\S]*\bjazz\b/i);

    await mainDialog.getByRole("button", { name: /Save as playlist|שמור כפלייליסט/i }).click();
    const saveDialog = page.getByRole("dialog", { name: /Save as playlist|שמור כפלייליסט/i });
    await expect(saveDialog).toBeVisible({ timeout: 5_000 });
    const nameInput = saveDialog.locator('input[placeholder*="Playlist"], input[placeholder*="פלייליסט"]');
    await nameInput.fill(`E2E Gym save ${Date.now()}`);

    const createPromise = page.waitForResponse(
      (res) => /\/api\/playlists(?:\b|\/|\?)/.test(res.url()) && res.request().method() === "POST",
      { timeout: 90_000 },
    );
    await saveDialog.getByRole("button", { name: /^Save$|^שמירה$/i }).click();
    const createRes = await createPromise;
    expect(createRes.ok(), `POST playlists failed ${createRes.status()}`).toBeTruthy();

    expect(playNowHits, "saving a draft must not hit play-now").toBe(0);
  });

  test("8) Save persistence: POST+GET validate, edit page, reload, DJ Creator Hub", async ({ page }) => {
    test.setTimeout(300_000);
    const playlistTitle = `E2E Persist ${Date.now()}`;
    const djRailBtn = page.getByRole("button", {
      name: /DJ Creator playlists and assistant|DJ Creator AI/i,
    });

    await openDjAssistant(page);
    const mainDialog = page.getByRole("dialog", { name: /DJ Creator AI|יוצר/i });

    await clickFirstMatchingOption(mainDialog, /Gym|חדר כושר/i);
    await clickFirstMatchingOption(mainDialog, /Night|לילה/i);
    await clickFirstMatchingOption(mainDialog, /High energy|אנרגיה גבוהה/i);
    await clickFirstMatchingOption(mainDialog, /Afro|אפרו/i);
    await clickFirstMatchingOption(mainDialog, /Active|פעיל/i);
    await mainDialog.getByRole("button", { name: /Get my 10|10 המלצות/i }).click();

    const picks = mainDialog.locator("ul").locator("li");
    await expect(picks.first()).toBeVisible({ timeout: 35_000 });
    const pickTexts = await picks.allInnerTexts();

    /** First substantive line inside a draft row (avoid index number-only line). */
    const firstPickLine =
      pickTexts
        .map((blob) =>
          blob
            .split("\n")
            .map((x) => x.trim())
            .find((ln) => ln.length >= 4 && ln.toLowerCase() !== "youtube" && !/^[0-9]+$/.test(ln)),
        )
        .find((ln) => Boolean(ln)) ?? "";
    expect(firstPickLine.length, "could not read first pick title from draft").toBeGreaterThan(3);

    await mainDialog.getByRole("button", { name: /Save as playlist|שמור כפלייליסט/i }).click();
    const saveDialog = page.getByRole("dialog", { name: /Save as playlist|שמור כפלייליסט/i });
    await expect(saveDialog).toBeVisible({ timeout: 10_000 });
    await saveDialog.locator('input[placeholder*="Playlist"], input[placeholder*="פלייליסט"]').fill(playlistTitle);

    const playlistGetVerify = page.waitForResponse(
      (res) => res.request().method() === "GET" && res.ok() && isPlaylistDocumentGet(res.url()),
      { timeout: 90_000 },
    );

    const createPromise = page.waitForResponse(
      (res) => res.request().method() === "POST" && isPlaylistCreatePost(res.url()),
      { timeout: 90_000 },
    );

    await Promise.all([
      createPromise,
      playlistGetVerify,
      saveDialog.getByRole("button", { name: /^Save$|^שמירה$/i }).click(),
    ]);

    const postRes = await createPromise;
    expect(postRes.ok(), `POST /api/playlists failed ${postRes.status()}`).toBeTruthy();
    const getVerifyRes = await playlistGetVerify;
    expect(getVerifyRes.ok()).toBeTruthy();
    const persisted = (await getVerifyRes.json()) as { id?: string; genre?: string; tracks?: unknown[]; url?: string };
    expect(String(persisted.genre ?? "").trim()).toBe("DJ Creator");
    expect(Array.isArray(persisted.tracks)).toBeTruthy();
    expect((persisted.tracks as unknown[]).length).toBeGreaterThanOrEqual(10);

    const openDraftLink = mainDialog.getByRole("link", { name: /Open playlist|פתיחת הפלייליסט/i });
    await expect(openDraftLink).toBeVisible({ timeout: 30_000 });
    const editHref = await openDraftLink.getAttribute("href");
    expect(editHref, "Open playlist href").toMatch(/\/playlists\/[^/]+\/edit(?:\/)?$/);
    const afterNavGet = page.waitForResponse(
      (res) => res.request().method() === "GET" && res.ok() && isPlaylistDocumentGet(res.url()),
      { timeout: 60_000 },
    );
    await Promise.all([afterNavGet, openDraftLink.click()]);

    await expect(page).toHaveURL(/\/playlists\/[^/]+\/edit/);
    expect((await afterNavGet).ok()).toBeTruthy();
    await expect(page.getByRole("heading", { name: /Edit playlist/i })).toBeVisible({
      timeout: 30_000,
    });

    const editForm = page.locator("form").filter({ has: page.getByText("Name", { exact: true }) }).first();
    await expect(editForm.locator("input").nth(0)).toHaveValue(playlistTitle);
    await expect(editForm.locator("input").nth(2)).toHaveValue("DJ Creator");

    await expect(page.getByText("Tracks (reorder)")).toBeVisible();
    await expect.poll(() => page.locator("span.truncate.text-sm.text-slate-200").count(), { timeout: 15_000 }).toBe(10);

    /** First saved track row should include text from catalog draft row (server-rendered titles). */
    const pickSnippet = firstPickLine.length > 28 ? firstPickLine.slice(0, 28) : firstPickLine;
    await expect(page.locator("span.truncate.text-sm.text-slate-200").first()).toContainText(pickSnippet);

    const reloadGet = page.waitForResponse(
      (res) => res.request().method() === "GET" && res.ok() && isPlaylistDocumentGet(res.url()),
      { timeout: 60_000 },
    );
    await Promise.all([reloadGet, page.reload({ waitUntil: "domcontentloaded" })]);
    expect((await reloadGet).ok()).toBeTruthy();

    await expect(editForm.locator("input").nth(0)).toHaveValue(playlistTitle);
    await expect.poll(() => page.locator("span.truncate.text-sm.text-slate-200").count()).toBe(10);

    await page.goto("/sources", { waitUntil: "domcontentloaded", timeout: 120_000 });
    await djRailBtn.waitFor({ state: "visible", timeout: 30_000 });

    const unifiedWait = page.waitForResponse(
      (res) =>
        res.request().method() === "GET" &&
        res.ok() &&
        res.url().includes("/api/sources/unified"),
      { timeout: 90_000 },
    );

    await Promise.all([
      unifiedWait,
      page.evaluate(() => window.dispatchEvent(new Event("library-updated"))),
    ]);
    const unifiedRes = await unifiedWait;
    const unifiedItems = (await unifiedRes.json()) as Array<{
      origin?: string;
      title?: string;
      genre?: string;
    }>;

    const playlistUnifiedMatch = unifiedItems.find(
      (s) =>
        s.origin === "playlist" &&
        String(s.genre ?? "").trim() === "DJ Creator" &&
        s.title === playlistTitle,
    );
    expect(playlistUnifiedMatch, "saved playlist row in unified response").toBeTruthy();

    /** Full reload so hydration + SourcesManager pick up unified items before hub reads context. */
    await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
    await djRailBtn.waitFor({ state: "visible", timeout: 45_000 });

    const unifiedWarm = page.waitForResponse(
      (res) =>
        res.request().method() === "GET" &&
        res.ok() &&
        res.url().includes("/api/sources/unified"),
      { timeout: 90_000 },
    );
    await Promise.all([
      unifiedWarm,
      page.evaluate(() => window.dispatchEvent(new Event("library-updated"))),
    ]);
    await unifiedWarm;

    await djRailBtn.click();
    await expect(
      page.getByRole("heading", { name: /DJ Creator playlists|פלייליסטים מ־DJ Creator/i }),
    ).toBeVisible({ timeout: 15_000 });

    expect(persisted.id?.trim(), "persisted playlist id").toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    const pid = persisted.id!;
    const emptyCopy = page.getByText(/No DJ Creator playlists yet|עדיין אין פלייליסטים/i);
    const hubEditLink = page.locator(`a[href*="/playlists/${pid}/edit"]`).first();

    await expect
      .poll(async () => hubEditLink.isVisible().catch(() => false), {
        timeout: 45_000,
        intervals: [100, 250, 500],
      })
      .toBeTruthy();
    await expect(emptyCopy).not.toBeVisible();
    await expect(hubEditLink).toBeVisible();
    await expect(hubEditLink.getByText(/Open playlist|פתיחת הפלייליסט/i)).toBeVisible();
  });
});

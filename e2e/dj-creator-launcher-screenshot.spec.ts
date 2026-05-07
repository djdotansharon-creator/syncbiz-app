import { test, expect } from "@playwright/test";
import path from "node:path";

test.use({ deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });

test("DJ Creator launcher card screenshot", async ({ page }) => {
  const loginRes = await page.request.post("/api/auth/login", {
    data: { email: "test@syncbiz.com", password: "test123" },
  });
  if (!loginRes.ok()) throw new Error(`login ${loginRes.status()}`);

  await page.goto("/sources", { waitUntil: "domcontentloaded", timeout: 60_000 });
  const launcherBtn = page.getByRole("button", { name: /Open assistant|פתיחת העוזר/i });
  await launcherBtn.waitFor({ state: "visible", timeout: 30_000 });

  const card = launcherBtn.locator("xpath=ancestor::section[1]");
  await card.waitFor({ state: "visible", timeout: 10_000 });

  const out = path.join(process.cwd(), "e2e", "screenshots", "dj-creator-launcher.png");
  await card.screenshot({ path: out });

  const iconImg = card.locator('img[src*="dj-creator-icon-B.png"]');
  await iconImg.waitFor({ state: "visible", timeout: 10_000 });
  const iconOut = path.join(process.cwd(), "e2e", "screenshots", "dj-creator-launcher-icon.png");
  await iconImg.screenshot({ path: iconOut });

  expect(out).toBeTruthy();
});

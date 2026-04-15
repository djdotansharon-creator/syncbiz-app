import { test, expect } from "@playwright/test";

const YOUTUBE_MIX_URL =
  "https://www.youtube.com/watch?v=pmMHCUfiTuI&list=RDpmMHCUfiTuI&start_radio=1";

// The LibraryInputArea has TWO inputs:
//   1. URL input  → inputMode="url", placeholder "Add URL source…"  — submits via "Add" button
//   2. Search input → type="search" — for local/YouTube search
// We must target the URL input, not the search input.

test.describe("YouTube Mix import", () => {
  test.beforeEach(async ({ page }) => {
    // ── Login ──────────────────────────────────────────────────────────────
    await page.goto("/login");
    await page.locator("#email").fill("test@syncbiz.com");
    await page.locator("#password").fill("test123");
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/(dashboard|sources|library)/, { timeout: 15_000 });
  });

  test("pasting a YouTube mix URL triggers the mix import panel", async ({ page }) => {
    await page.goto("/sources");
    await page.waitForLoadState("networkidle");

    const urlInput = page.locator('input[inputmode="url"]').first();
    await expect(urlInput).toBeVisible({ timeout: 10_000 });

    await urlInput.fill(YOUTUBE_MIX_URL);

    const addBtn = page.locator('button[type="submit"]').filter({ hasText: /^Add/ }).first();
    await expect(addBtn).toBeEnabled({ timeout: 3_000 });
    await addBtn.click();

    await expect(
      page.locator('[aria-labelledby="youtube-mix-import-heading"]'),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("YouTube mix import panel enumerates tracks successfully", async ({ page }) => {
    await page.goto("/sources");
    await page.waitForLoadState("networkidle");

    const urlInput = page.locator('input[inputmode="url"]').first();
    await expect(urlInput).toBeVisible({ timeout: 10_000 });

    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/sources/youtube-mix-candidates"),
      { timeout: 35_000 },
    );

    await urlInput.fill(YOUTUBE_MIX_URL);
    const addBtn = page.locator('button[type="submit"]').filter({ hasText: /^Add/ }).first();
    await addBtn.click();

    const response = await responsePromise;
    const body = await response.json().catch(() => ({})) as { candidates?: unknown[]; error?: string };

    console.log("\n[test] /api/sources/youtube-mix-candidates");
    console.log("[test] HTTP status:", response.status());
    console.log("[test] candidates:", (body.candidates ?? []).length);
    console.log("[test] error:", body.error ?? "(none)");

    const panel = page.locator('[aria-labelledby="youtube-mix-import-heading"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Must return candidates with no error
    expect(body.error).toBeUndefined();
    expect(Array.isArray(body.candidates) && body.candidates.length > 0).toBe(true);

    // Panel must show the track list, not an error state
    await expect(panel.locator("ul")).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText("Track enumeration is unavailable", { exact: false })).not.toBeVisible();
    await expect(panel.getByText("Could not load tracks", { exact: false })).not.toBeVisible();

    console.log("[test] ✓ Mix import returned", body.candidates?.length, "tracks successfully");
  });
});

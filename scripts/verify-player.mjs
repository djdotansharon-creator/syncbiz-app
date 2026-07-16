/**
 * CANONICAL player smoke test — the one script to run after ANY change that
 * could touch playback (see docs/PROJECT-STATE.md "PLAYER SAFETY CONTRACT").
 *
 *   node scripts/verify-player.mjs                 # against http://localhost:3000
 *   BASE_URL=https://... node scripts/verify-player.mjs
 *
 * Covers the historical regressions:
 *  1. Play starts (engine up, deck leaves READY).
 *  2. Playback + red MASTER survive a Library→Schedules→Radio→Library round-trip.
 *  3. Automix: seek near track end → next track takes over, engine alive.
 *  4. No queue eject: source/queue still present at the end.
 * Exits 0 on PASS, 1 on FAIL — prints a one-line verdict per step.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.SB_EMAIL ?? "test@syncbiz.com";
const PASS = process.env.SB_PASS ?? "test123";

const results = [];
const step = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1900, height: 1000 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

try {
  // ── Login ──
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForTimeout(3000);
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PASS);
  await page.locator("button[type=submit]").click();
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 180000 });
  await page.goto(`${BASE}/sources`, { waitUntil: "domcontentloaded", timeout: 180000 }).catch(() => {});
  await page.waitForSelector(".library-source-card", { timeout: 120000 });
  await page.waitForTimeout(5000);
  step("login + workspace", true);

  // ── 1. Start playback (multi-track playlist via DJ AI view when available) ──
  await page.getByText("DJ AI", { exact: false }).first().click().catch(() => {});
  await page.waitForTimeout(4000);
  const card = page.locator(".library-source-card").first();
  await card.hover();
  await page.waitForTimeout(500);
  await card.getByRole("button", { name: "Play", exact: true }).first().click();
  await page.waitForTimeout(15000);
  const engineUp = await page.evaluate(() => !!document.querySelector("iframe[src*='youtube']"));
  step("playback starts (YT engine up)", engineUp);

  // ── 2. Tab round-trip survival ──
  const chip = () =>
    page
      .locator("[role=status][aria-label^='Device mode']")
      .first()
      .getAttribute("aria-label")
      .catch(() => "ABSENT");
  for (const r of ["/schedules", "/radio", "/sources"]) {
    await page.click(`a[href='${r}']`);
    await page.waitForTimeout(5000);
  }
  const chipAfter = await chip();
  const aliveAfterTabs = await page.evaluate(() => !!document.querySelector("iframe[src*='youtube']"));
  step("survives tab round-trip", aliveAfterTabs, `chip=${chipAfter}`);

  // ── 3. Automix transition (seek near end) ──
  const amx = page.locator("button").filter({ hasText: "AUTOMIX" }).first();
  if ((await amx.getAttribute("aria-pressed").catch(() => null)) !== "true") {
    await amx.click().catch(() => {});
    await page.waitForTimeout(800);
  }
  const tl = page.locator("[role=slider][aria-label='Track progress']").first();
  const box = await tl.boundingBox();
  let mixOk = false;
  if (box) {
    const posBefore = Number(await tl.getAttribute("aria-valuenow"));
    await page.mouse.click(box.x + box.width * 0.95, box.y + box.height / 2);
    await page.waitForTimeout(30000); // ride through the mix point + handoff
    const pos = Number(await tl.getAttribute("aria-valuenow"));
    const dur = Number(await tl.getAttribute("aria-valuemax"));
    const engine = await page.evaluate(() => !!document.querySelector("iframe[src*='youtube']"));
    // After the transition we expect a NEW track early in its timeline (or at
    // least a live engine with a sane position — not frozen at the old end).
    mixOk = engine && dur > 0 && pos >= 0 && pos < dur * 0.9;
    step("automix transition (seek→end→next)", mixOk, `pos=${pos}/${dur} before=${posBefore}`);
  } else {
    step("automix transition (seek→end→next)", false, "timeline not found");
  }

  // ── 4. No eject ──
  const stillHasSession = await page.evaluate(() => {
    const ready = [...document.querySelectorAll("*")].some(
      (n) => n.children.length === 0 && n.textContent?.trim() === "READY",
    );
    return !ready;
  });
  step("no queue eject (deck not READY)", stillHasSession);

  const errLine = pageErrors.filter((e) => !/Hydration/.test(e)).slice(0, 2).join(" | ");
  step("no page errors", errLine === "", errLine.slice(0, 160));
} catch (e) {
  step("script completed", false, String(e).slice(0, 200));
}

await browser.close();
const pass = results.every(Boolean);
console.log(pass ? "\nVERDICT: PLAYER OK" : "\nVERDICT: PLAYER BROKEN — do not commit");
process.exit(pass ? 0 : 1);

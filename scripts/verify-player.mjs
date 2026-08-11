/**
 * SyncBiz — Playback Regression Harness (P1.1).
 *
 * The CANONICAL smoke test after ANY change that could touch playback. It proves the
 * existing playback baseline stays stable across Sources / navigation / CONTROL / automix
 * without stopping, restarting, ejecting, or resetting the queue.
 *
 * Design principles (owner directive):
 *  - CONDITION-BASED, not sleep-based. Every wait polls a real signal with a timeout +
 *    a clear failure code. No fixed `sleep(5000)` to paper over races.
 *  - SETUP failures (auth / app-ready / sources / WS / MASTER / playable source) are
 *    classified SEPARATELY from PLAYBACK failures. A login flake is NEVER a "playback fail".
 *  - State is read from a READ-ONLY diagnostic probe `window.__sbHarness()` (components/
 *    harness-playback-probe.tsx) + the DOM timeline slider for live position.
 *  - The YouTube embed-throttle false-positive is classified ENV, never a code failure.
 *
 * Commands:
 *   npm run test:playback         # SETUP + browser TEST 01–06
 *   npm run test:playback:soak    # + long-running soak (SOAK_MS, default 120s)
 *   BASE_URL=... SB_EMAIL=... node scripts/verify-player.mjs
 *
 * Exit 0 only if SETUP is green AND no PLAYBACK test FAILed (ENV/MANUAL/SKIP don't fail).
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.SB_EMAIL ?? "djdotansharon@gmail.com"; // cookie = base64(email)
const SOAK = process.argv.includes("--soak");
const SOAK_MS = Number(process.env.SOAK_MS ?? 120_000);

// ── Failure codes ───────────────────────────────────────────────────────────
const C = {
  // setup
  SETUP_AUTH_FAILED: "SETUP_AUTH_FAILED",
  SETUP_APP_READY_FAILED: "SETUP_APP_READY_FAILED",
  SETUP_SOURCES_FAILED: "SETUP_SOURCES_FAILED",
  SETUP_WS_FAILED: "SETUP_WS_FAILED",
  SETUP_MASTER_FAILED: "SETUP_MASTER_FAILED",
  SETUP_PLAYABLE_SOURCE_FAILED: "SETUP_PLAYABLE_SOURCE_FAILED",
  // playback
  PLAYBACK_DID_NOT_START: "PLAYBACK_DID_NOT_START",
  TRACK_RESTARTED: "TRACK_RESTARTED",
  MASTER_CHANGED_UNEXPECTEDLY: "MASTER_CHANGED_UNEXPECTEDLY",
  TRACK_CHANGED_UNEXPECTEDLY: "TRACK_CHANGED_UNEXPECTEDLY",
  QUEUE_RESET: "QUEUE_RESET",
  QUEUE_MUTATED_UNEXPECTEDLY: "QUEUE_MUTATED_UNEXPECTEDLY",
  DUPLICATE_PLAYBACK_COMMAND: "DUPLICATE_PLAYBACK_COMMAND",
  AUTOMIX_FAILED: "AUTOMIX_FAILED",
  NEXT_TRACK_STARTED_TWICE: "NEXT_TRACK_STARTED_TWICE",
  RECONNECT_RESTARTED_TRACK: "RECONNECT_RESTARTED_TRACK",
  PLAYBACK_STOPPED_UNEXPECTEDLY: "PLAYBACK_STOPPED_UNEXPECTEDLY",
};

class HarnessError extends Error {
  constructor(code, detail) { super(`${code}${detail ? " — " + detail : ""}`); this.code = code; this.detail = detail; }
}

// ── Result tracking ──────────────────────────────────────────────────────────
const setup = [];   // { name, ok, code?, detail? }
const tests = [];   // { name, status: PASS|FAIL|ENV|MANUAL|SKIP, code?, detail? }
const notes = [];
const S = (name, ok, code, detail) => setup.push({ name, ok, code, detail });
const T = (name, status, code, detail) => tests.push({ name, status, code, detail });

// ── Condition-based wait ─────────────────────────────────────────────────────
async function waitUntil(fn, { timeout = 20_000, poll = 250, code, label } = {}) {
  const start = Date.now();
  let last;
  for (;;) {
    try { last = await fn(); if (last) return last; } catch (e) { last = String(e?.message ?? e); }
    if (Date.now() - start > timeout) {
      throw new HarnessError(code ?? "WAIT_TIMEOUT", `${label ?? "condition"} not met in ${timeout}ms (last=${JSON.stringify(last)?.slice(0, 120)})`);
    }
    await new Promise((r) => setTimeout(r, poll));
  }
}

// ── State snapshot (probe + DOM slider position) ─────────────────────────────
async function snap(page) {
  // The probe global can be transiently absent during dev RSC remounts / WS reconnects —
  // retry briefly to bridge those windows so a flicker is never misread as "not playing".
  let s = null;
  for (let i = 0; i < 8; i++) {
    s = await page.evaluate(() => window.__sbState ?? null).catch(() => null);
    if (s) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  let position = null, duration = null;
  const el = await page.$("[role=slider][aria-label='Track progress']");
  if (el) {
    const now = await el.getAttribute("aria-valuenow");
    const max = await el.getAttribute("aria-valuemax");
    position = now == null ? null : Number(now);
    duration = max == null ? null : Number(max);
  }
  return { ...(s ?? {}), position, duration };
}
const fmt = (s) => s ? `src=${(s.currentSourceId ?? "-")} idx=${s.currentTrackIndex} pos=${s.position ?? "-"}/${s.duration ?? "-"} status=${s.status} mode=${s.deviceMode} q=${s.queueIndex}/${s.queueLen} epoch=${s.playCommandEpoch}` : "(no snapshot)";

// ── Navigation (condition-based; proves IRON RULE: socket/MASTER survive route switch) ─
async function goRoute(page, href) {
  await page.click(`a[href='${href}']`);
  await waitUntil(() => page.evaluate((h) => location.pathname === h, href), { timeout: 15_000, code: "NAV", label: `route ${href}` });
}

// ── Start playback on the first playable library card (locale-agnostic) ──────
async function startFirstCard(page) {
  const card = page.locator(".library-source-card").first();
  await card.waitFor({ state: "visible", timeout: 30_000 });
  await card.scrollIntoViewIfNeeded().catch(() => {});
  await card.hover().catch(() => {});
  // Play button label is localized ("Play" / "השמע"); match either.
  const play = card.getByRole("button", { name: /^(Play|השמע)$/ }).first();
  await play.waitFor({ state: "visible", timeout: 15_000 });
  await play.click({ timeout: 15_000 });
}

// ── Position-advance / YT-throttle probe ─────────────────────────────────────
async function positionAdvances(page, { windowMs = 6000 } = {}) {
  const a = await snap(page);
  if (a.position == null) return { advanced: null, reason: "no-slider" };
  await new Promise((r) => setTimeout(r, windowMs));
  const b = await snap(page);
  if (b.position == null) return { advanced: null, reason: "no-slider" };
  return { advanced: b.position > a.position + 0.3, from: a.position, to: b.position, type: b.currentType };
}

// ═════════════════════════════ SETUP ═════════════════════════════════════════
async function runSetup(page, context) {
  // 1. Auth — inject the session cookie (base64 of email). Robust vs dev login-form flake.
  try {
    await context.addCookies([{ name: "syncbiz-session", value: Buffer.from(EMAIL).toString("base64"), url: BASE }]);
    await page.goto(`${BASE}/sources`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitUntil(() => page.evaluate(() => location.pathname === "/sources"), { timeout: 20_000, code: C.SETUP_AUTH_FAILED, label: "reach /sources (not redirected to /login)" });
    S("Authenticated", true);
  } catch (e) { S("Authenticated", false, e.code ?? C.SETUP_AUTH_FAILED, e.detail ?? String(e.message)); throw e; }

  // 2. App ready — the client hydrated and the read-only probe is mounted.
  try {
    await waitUntil(() => page.evaluate(() => !!window.__sbState), { timeout: 45_000, code: C.SETUP_APP_READY_FAILED, label: "app hydrated (probe present)" });
    S("App ready", true);
  } catch (e) { S("App ready", false, e.code, e.detail); throw e; }

  // 3. Sources loaded — at least one library card rendered.
  try {
    await waitUntil(async () => (await page.locator(".library-source-card").count()) >= 1, { timeout: 30_000, code: C.SETUP_SOURCES_FAILED, label: "≥1 library card" });
    S("Sources loaded", true);
  } catch (e) { S("Sources loaded", false, e.code, e.detail); throw e; }

  // 4. WS connected — real branch socket up (not prod-pointed / not aborted-token).
  try {
    await waitUntil(async () => (await snap(page)).wsStatus === "connected", { timeout: 30_000, code: C.SETUP_WS_FAILED, label: "WS status=connected" });
    S("WS connected", true);
  } catch (e) { S("WS connected", false, e.code, e.detail); throw e; }

  // 5. MASTER ready — this tab holds the branch MASTER lease (proves not forced CONTROL).
  try {
    const st = await waitUntil(async () => { const s = await snap(page); return (s.deviceMode === "MASTER" && s.isBranchConnected) ? s : false; },
      { timeout: 30_000, code: C.SETUP_MASTER_FAILED, label: "deviceMode=MASTER & branch-connected" });
    S("MASTER ready", true, undefined, `deviceId=${st.deviceId}`);
  } catch (e) { S("MASTER ready", false, e.code, e.detail); throw e; }

  // 6. Playable source — first card exposes a Play control.
  try {
    const card = page.locator(".library-source-card").first();
    await card.hover().catch(() => {});
    await card.getByRole("button", { name: /^(Play|השמע)$/ }).first().waitFor({ state: "visible", timeout: 15_000 });
    S("Playable source found", true);
  } catch (e) { S("Playable source found", false, C.SETUP_PLAYABLE_SOURCE_FAILED, String(e.message).slice(0, 120)); throw new HarnessError(C.SETUP_PLAYABLE_SOURCE_FAILED, String(e.message).slice(0, 120)); }
}

// ═════════════════════════════ PLAYBACK TESTS ═══════════════════════════════
let ENV_THROTTLE = false; // set true if YT engine reports playing but position never advances

// TEST 01 — Play starts
async function test01(page) {
  const name = "01 Play starts";
  try {
    const before = await snap(page);
    await startFirstCard(page);
    const started = await waitUntil(async () => { const s = await snap(page); return (s.status === "playing" && s.currentSourceId) ? s : false; },
      { timeout: 25_000, code: C.PLAYBACK_DID_NOT_START, label: "status=playing & source set" });
    // No immediate eject/stop: still playing on the same source ~2.5s later.
    await new Promise((r) => setTimeout(r, 2500));
    const after = await snap(page);
    if (after.status !== "playing" || after.currentSourceId !== started.currentSourceId)
      throw new HarnessError(C.PLAYBACK_STOPPED_UNEXPECTEDLY, `after=${fmt(after)}`);
    if (before.playCommandEpoch != null && after.playCommandEpoch != null && after.playCommandEpoch - before.playCommandEpoch > 1)
      throw new HarnessError(C.DUPLICATE_PLAYBACK_COMMAND, `epoch ${before.playCommandEpoch}→${after.playCommandEpoch}`);
    // Position advancing? (classifies YT throttle as ENV, not a failure)
    const adv = await positionAdvances(page);
    if (adv.advanced === false && after.currentType === "youtube") {
      ENV_THROTTLE = true;
      notes.push(`YT_THROTTLE_SUSPECTED: engine=playing but position stuck (${adv.from}→${adv.to}). Position-dependent tests marked ENV. See PROJECT-STATE line 13.`);
    }
    T(name, "PASS", undefined, `${fmt(after)}${adv.advanced === false ? " [pos-stuck→ENV]" : ""}`);
    return started;
  } catch (e) { T(name, "FAIL", e.code ?? "ERROR", e.detail ?? String(e.message).slice(0, 160)); return null; }
}

// TEST 02 — Navigation survival (IRON RULE)
async function test02(page) {
  const name = "02 Navigation survival";
  try {
    const before = await snap(page);
    if (before.status !== "playing") { T(name, "SKIP", undefined, "not playing (TEST 01 did not start)"); return; }
    for (const r of ["/schedules", "/radio", "/sources"]) await goRoute(page, r);
    await waitUntil(async () => (await page.locator(".library-source-card").count()) >= 1, { timeout: 15_000, code: "NAV", label: "back on /sources" });
    const after = await snap(page);
    if (after.deviceMode !== "MASTER") throw new HarnessError(C.MASTER_CHANGED_UNEXPECTEDLY, `mode=${after.deviceMode}`);
    if (after.currentSourceId !== before.currentSourceId) throw new HarnessError(C.TRACK_CHANGED_UNEXPECTEDLY, `${before.currentSourceId}→${after.currentSourceId}`);
    if (after.status !== "playing") throw new HarnessError(C.PLAYBACK_STOPPED_UNEXPECTEDLY, `status=${after.status}`);
    if (after.playCommandEpoch != null && before.playCommandEpoch != null && after.playCommandEpoch !== before.playCommandEpoch)
      throw new HarnessError(C.DUPLICATE_PLAYBACK_COMMAND, `epoch ${before.playCommandEpoch}→${after.playCommandEpoch} (nav issued a play)`);
    // Position monotonic (unless throttled → ENV): must not reset toward 0.
    if (!ENV_THROTTLE && before.position != null && after.position != null) {
      if (before.position > 5 && after.position < 2) throw new HarnessError(C.TRACK_RESTARTED, `pos ${before.position}→${after.position}`);
      T(name, "PASS", undefined, `same src, mode MASTER, pos ${before.position}→${after.position} monotonic`);
    } else {
      T(name, ENV_THROTTLE ? "ENV" : "PASS", undefined, `same src+MASTER, status playing${ENV_THROTTLE ? " (position unverifiable — throttle)" : ""}`);
    }
  } catch (e) { T(name, "FAIL", e.code ?? "ERROR", e.detail ?? String(e.message).slice(0, 160)); }
}

// TEST 03 — CONTROL lifecycle (needs a 2nd coordinated device → INTEGRATION)
async function test03() {
  T("03 CONTROL lifecycle", "MANUAL", undefined,
    "Requires MASTER device + separate CONTROL device. Procedure: open /sources on device A (MASTER, playing) + device B (CONTROL mirror); close/reload B; verify A keeps playing (same track/position), B re-adopts MASTER state on return, no duplicate audio, no unnecessary MASTER takeover. Not faked in single-browser automation.");
}

// TEST 04 — Automix / end-of-track (self-contained: uses a deterministic multi-track playlist)
// A multi-track PLAYLIST is one queue item (queueLen 1) whose tracks advance via currentTrackIndex.
// The DJ AI view lists the account's multi-track playlists; card[0] is a 15-track playlist.
async function test04(page) {
  const name = "04 Automix / end-of-track";
  try {
    // Switch to a multi-track playlist so an end-of-track transition can actually happen.
    await page.getByText(/^DJ AI$/).first().click({ timeout: 8_000 });
    await waitUntil(async () => (await page.locator(".library-source-card").count()) >= 1, { timeout: 12_000, code: C.AUTOMIX_FAILED, label: "DJ AI cards" });
    const card = page.locator(".library-source-card").first();
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await card.hover().catch(() => {});
    await card.getByRole("button", { name: /^(Play|השמע)$/ }).first().click({ timeout: 12_000 });
    const A = await waitUntil(async () => { const s = await snap(page); return (s.status === "playing" && s.currentSourceId && (s.playlistTrackCount ?? 0) >= 2) ? s : false; },
      { timeout: 25_000, code: C.AUTOMIX_FAILED, label: "multi-track playlist playing (playlistTrackCount>=2)" });
    if (ENV_THROTTLE) { T(name, "ENV", undefined, "position not advancing (throttle)"); return; }
    // The current track buffers briefly on load — wait for a finite duration + live position.
    const D = await waitUntil(async () => { const s = await snap(page); return (s.duration != null && s.duration > 1 && s.duration < 36_000 && s.position != null) ? s : false; },
      { timeout: 20_000, code: C.AUTOMIX_FAILED, label: "current track finite duration" });
    const idxBefore = D.currentTrackIndex ?? A.currentTrackIndex ?? 0;
    // Seek near the END of the CURRENT track via a real click on the timeline (range input),
    // then wait for a single forward transition. A pointer event drives the real seek handler.
    const slider = await page.$("[role=slider][aria-label='Track progress']");
    const box = await slider.boundingBox();
    if (!box) throw new HarnessError(C.AUTOMIX_FAILED, "timeline slider not visible");
    await page.mouse.click(box.x + box.width * 0.97, box.y + box.height / 2);
    const B = await waitUntil(async () => { const s = await snap(page); return (s.currentTrackIndex != null && s.currentTrackIndex > idxBefore) ? s : false; },
      { timeout: 30_000, code: C.AUTOMIX_FAILED, label: "advance to next track (currentTrackIndex++)" });
    if (B.status !== "playing") throw new HarnessError(C.PLAYBACK_STOPPED_UNEXPECTEDLY, `after transition status=${B.status}`);
    if (B.currentSourceId !== A.currentSourceId) throw new HarnessError(C.TRACK_CHANGED_UNEXPECTEDLY, `playlist changed ${A.currentSourceId}→${B.currentSourceId}`);
    if (B.deviceMode !== "MASTER") throw new HarnessError(C.MASTER_CHANGED_UNEXPECTEDLY, `mode=${B.deviceMode}`);
    if (A.playCommandEpoch != null && B.playCommandEpoch != null && B.playCommandEpoch - A.playCommandEpoch > 1)
      throw new HarnessError(C.NEXT_TRACK_STARTED_TWICE, `epoch ${A.playCommandEpoch}→${B.playCommandEpoch}`);
    // Settle: exactly one advance (idx +1), no double-start.
    await new Promise((r) => setTimeout(r, 2500));
    const settle = await snap(page);
    if (settle.currentTrackIndex != null && settle.currentTrackIndex - idxBefore > 1)
      throw new HarnessError(C.NEXT_TRACK_STARTED_TWICE, `idx ${idxBefore}→${settle.currentTrackIndex}`);
    console.log(`  [04 A→B] A: idx=${idxBefore} pos=${D.position?.toFixed?.(1)}/${D.duration?.toFixed?.(0)} src=${(D.currentSourceId ?? "").slice(0, 14)}  →  B: idx=${B.currentTrackIndex} pos=${(settle.position ?? B.position)?.toFixed?.(1)} src=${(B.currentSourceId ?? "").slice(0, 14)}`);
    T(name, "PASS", undefined, `A idx${idxBefore} → B idx${B.currentTrackIndex} (one advance), same playlist+MASTER, no double-start, playing`);
  } catch (e) { T(name, "FAIL", e.code ?? "ERROR", e.detail ?? String(e.message).slice(0, 160)); }
}

// TEST 05 — Queue integrity across navigation
async function test05(page) {
  const name = "05 Queue integrity";
  try {
    const before = await snap(page);
    if (before.status !== "playing" || before.queueLen < 1) { T(name, "SKIP", undefined, `status=${before.status} queueLen=${before.queueLen}`); return; }
    for (const r of ["/schedules", "/sources", "/radio", "/sources"]) await goRoute(page, r);
    await waitUntil(async () => (await page.locator(".library-source-card").count()) >= 1, { timeout: 15_000, code: "NAV", label: "back on /sources" });
    const after = await snap(page);
    if (after.queueLen !== before.queueLen) throw new HarnessError(C.QUEUE_MUTATED_UNEXPECTEDLY, `queueLen ${before.queueLen}→${after.queueLen}`);
    if (after.queueCurrentId !== before.queueCurrentId && after.currentSourceId === before.currentSourceId)
      throw new HarnessError(C.QUEUE_MUTATED_UNEXPECTEDLY, `queueCurrent ${before.queueCurrentId}→${after.queueCurrentId}`);
    T(name, "PASS", undefined, `queueLen ${after.queueLen} stable, current unchanged across 4 nav hops`);
  } catch (e) { T(name, "FAIL", e.code ?? "ERROR", e.detail ?? String(e.message).slice(0, 160)); }
}

// TEST 06 — Reconnect (network offline→online via CDP; automatable)
async function test06(page, context) {
  const name = "06 Reconnect";
  try {
    const before = await snap(page);
    if (before.status !== "playing") { T(name, "SKIP", undefined, "not playing"); return; }
    await context.setOffline(true);
    await new Promise((r) => setTimeout(r, 3000));            // brief real interruption
    await context.setOffline(false);
    // WS must return to connected, still MASTER, still the same track, not restarted.
    const rec = await waitUntil(async () => { const s = await snap(page); return s.wsStatus === "connected" ? s : false; }, { timeout: 30_000, code: "NAV", label: "WS reconnected" });
    if (rec.deviceMode !== "MASTER") throw new HarnessError(C.MASTER_CHANGED_UNEXPECTEDLY, `mode=${rec.deviceMode}`);
    if (rec.currentSourceId !== before.currentSourceId) throw new HarnessError(C.TRACK_CHANGED_UNEXPECTEDLY, `${before.currentSourceId}→${rec.currentSourceId}`);
    if (before.playCommandEpoch != null && rec.playCommandEpoch != null && rec.playCommandEpoch !== before.playCommandEpoch)
      throw new HarnessError(C.RECONNECT_RESTARTED_TRACK, `reconnect issued a play (epoch ${before.playCommandEpoch}→${rec.playCommandEpoch})`);
    if (!ENV_THROTTLE && before.position != null && rec.position != null && before.position > 5 && rec.position < 2)
      throw new HarnessError(C.RECONNECT_RESTARTED_TRACK, `pos ${before.position}→${rec.position}`);
    T(name, "PASS", undefined, `same MASTER+track after offline→online, no re-play (epoch ${rec.playCommandEpoch})`);
  } catch (e) { T(name, "FAIL", e.code ?? "ERROR", e.detail ?? String(e.message).slice(0, 160)); }
}

// TEST 07 — Local/server interruption while local playback (desktop/MPV) → INTEGRATION
async function test07() {
  T("07 Local/server interruption", "MANUAL", undefined,
    "Desktop/MPV + local files only (browser YT cannot play offline). Procedure: desktop app playing a LOCAL file → drop network → verify local playback continues and reconnect does not restart the track. Not representable in browser automation.");
}

// TEST 08 — Soak (opt-in, long-running)
async function test08(page) {
  const name = "08 Soak";
  if (!SOAK) { T(name, "SKIP", undefined, "run with --soak (npm run test:playback:soak)"); return; }
  try {
    const start = Date.now();
    let samples = 0, transitions = 0, unexpectedStops = 0, epochJumps = 0, masterChanges = 0;
    let prev = await snap(page);
    if (prev.status !== "playing") { T(name, "SKIP", undefined, "not playing at soak start"); return; }
    while (Date.now() - start < SOAK_MS) {
      await new Promise((r) => setTimeout(r, 5000));
      const s = await snap(page); samples++;
      if (s.deviceMode !== "MASTER") masterChanges++;
      if (s.status === "stopped" || s.status === "idle") unexpectedStops++;
      if (s.currentSourceId !== prev.currentSourceId || (s.currentTrackIndex ?? 0) !== (prev.currentTrackIndex ?? 0)) transitions++;
      if (s.playCommandEpoch != null && prev.playCommandEpoch != null && s.playCommandEpoch - prev.playCommandEpoch > 1) epochJumps++;
      prev = s;
    }
    const bad = masterChanges + unexpectedStops + epochJumps;
    T(name, bad === 0 ? "PASS" : "FAIL", bad === 0 ? undefined : "SOAK_DRIFT",
      `${Math.round(SOAK_MS / 1000)}s: samples=${samples} transitions=${transitions} masterChanges=${masterChanges} unexpectedStops=${unexpectedStops} epochJumps=${epochJumps}`);
  } catch (e) { T(name, "FAIL", "ERROR", String(e.message).slice(0, 160)); }
}

// ═════════════════════════════ RUN ═══════════════════════════════════════════
async function main() {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  // Test isolation: disable the time-of-day Schedule auto-player so it can't override the
  // harness's manual play with scheduled content (a real feature, but a confound for a
  // deterministic playback regression test). Set BEFORE any page script runs.
  await context.addInitScript(() => {
    try { localStorage.setItem("syncbiz-schedule-engine-enabled", "false"); } catch { /* noop */ }
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => { const t = String(e); if (!/Hydration/.test(t)) pageErrors.push(t); });

  let setupOk = true;
  try {
    await runSetup(page, context);
  } catch { setupOk = false; }

  if (setupOk) {
    const started = await test01(page);
    await test02(page);
    await test03();
    await test04(page);
    await test05(page);
    await test06(page, context);
    await test07();
    await test08(page);
  }

  await browser.close();

  // ── Readable summary ──
  const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
  const line = (r) => `[${pad(r.ok === undefined ? r.status : (r.ok ? "PASS" : "FAIL"), 6)}] ${r.name}${(r.code && (r.ok === false || r.status === "FAIL")) ? "  <" + r.code + ">" : ""}${r.detail ? "  — " + r.detail : ""}`;
  console.log("\nPLAYBACK REGRESSION");
  console.log("===================\n");
  console.log("SETUP");
  setup.forEach((r) => console.log("  " + line(r)));
  const setupFailed = setup.some((r) => !r.ok);
  console.log("\nBROWSER");
  tests.forEach((r) => console.log("  " + line(r)));
  if (notes.length) { console.log("\nNOTES"); notes.forEach((n) => console.log("  • " + n)); }
  if (pageErrors.length) { console.log("\nPAGE ERRORS"); pageErrors.slice(0, 3).forEach((e) => console.log("  ! " + e.slice(0, 160))); }

  const pass = tests.filter((t) => t.status === "PASS").length;
  const fail = tests.filter((t) => t.status === "FAIL").length;
  const env = tests.filter((t) => t.status === "ENV").length;
  const manual = tests.filter((t) => t.status === "MANUAL").length;
  const skip = tests.filter((t) => t.status === "SKIP").length;
  console.log("\nRESULT");
  if (setupFailed) {
    const f = setup.find((r) => !r.ok);
    console.log(`  SETUP FAILED (${f.code}) — playback NOT evaluated. This is a HARNESS/APP setup problem, not a playback failure.`);
    console.log(`\nVERDICT: SETUP_FAILED`);
    process.exit(2);
  }
  console.log(`  ${pass} PASS · ${fail} FAIL · ${env} ENV · ${manual} MANUAL · ${skip} SKIP`);
  console.log(`\nVERDICT: ${fail === 0 ? "PLAYBACK OK" : "PLAYBACK REGRESSION — do not commit"}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("harness crashed:", e); process.exit(3); });

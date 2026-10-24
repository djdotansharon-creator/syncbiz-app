/**
 * F4 — a scheduled jingle fires ONCE per browser profile, however many tabs are open (owner 2026-10-24).
 *
 * Bundles the REAL components/jingles-control/JingleScheduleAutoPlayer.tsx (esbuild + React) and replaces only
 * `@/lib/device-player-context` with a recorder (same `sendCommandToMaster` contract: silently drops the command
 * without masterDeviceId). Serves it on a throwaway localhost page and drives N real Chromium tabs that share one
 * localStorage schedule — the exact production shape.
 *
 * Run: npx tsx scripts/verify-jingle-schedule-single-fire.ts
 *      (CHROMIUM_PATH=/path/to/chrome to use a specific Chromium; otherwise Playwright's default.)
 */
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium, type BrowserContext, type Page } from "playwright";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (ok) pass++;
  else fail++;
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const FAKE_DEVICE_CONTEXT = `
  // Test double for lib/device-player-context: a mutable per-page object the test drives.
  const dp = (window.__dp = window.__dp || {
    deviceMode: "CONTROL",
    masterDeviceId: "master-1",
    sendCommandToMaster(command, payload) {
      if (!this.masterDeviceId) return; // same contract as the real provider: silent no-op without a MASTER
      window.__sent.push({ command, url: payload && payload.url, at: Date.now() });
    },
  });
  window.__sent = window.__sent || [];
  window.__local = window.__local || [];
  export function useDevicePlayer() { return dp; }
`;

const ENTRY = `
  import { createRoot } from "react-dom/client";
  import { createElement } from "react";
  import { JingleScheduleAutoPlayer } from "./components/jingles-control/JingleScheduleAutoPlayer";
  const params = new URLSearchParams(location.search);
  if (params.get("desktop") === "1") {
    window.syncbizDesktop = { mpvPlayInterrupt: (u) => { window.__local.push({ url: u, at: Date.now() }); } };
  }
  if (params.get("master") === "none") window.__dp.masterDeviceId = null;
  if (params.get("mode")) window.__dp.deviceMode = params.get("mode");
  createRoot(document.getElementById("root")).render(createElement(JingleScheduleAutoPlayer));
`;

async function main() {
  const root = path.join(__dirname, "..");
  const bundle = await build({
    stdin: { contents: ENTRY, resolveDir: root, loader: "tsx" },
    bundle: true,
    format: "iife",
    write: false,
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "fake-device-context",
        setup(b) {
          b.onResolve({ filter: /^@\/lib\/device-player-context$/ }, () => ({ path: "fake-dpc", namespace: "fake" }));
          b.onLoad({ filter: /.*/, namespace: "fake" }, () => ({ contents: FAKE_DEVICE_CONTEXT, loader: "js" }));
          b.onResolve({ filter: /^@\// }, (a) => ({ path: require.resolve(path.join(root, a.path.slice(2))) }));
        },
      },
    ],
  });
  // window.__dp must exist before the bundle's module body reads URL params → the fake module creates it.
  const html = `<!doctype html><meta charset=utf-8><title>jingle</title><div id=root></div><script>${bundle.outputFiles[0].text}</script>`;
  const server = http.createServer((_q, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
  });
  await new Promise<void>((r) => server.listen(0, "0.0.0.0", () => r()));
  const port = (server.address() as { port: number }).port;
  const base = `http://localhost:${port}/`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  const openTabs = async (ctx: BrowserContext, n: number, url = base): Promise<Page[]> => {
    const tabs: Page[] = [];
    for (let i = 0; i < n; i++) {
      const p = await ctx.newPage();
      await p.goto(url);
      tabs.push(p);
    }
    await sleep(300); // lock queue settled
    return tabs;
  };
  /** Write ONE schedule item (shared by every tab of the profile) firing `inMs` from now. */
  const scheduleIn = async (p: Page, inMs: number, repeat: "once" | "daily", extra: Record<string, unknown> = {}) => {
    const at = Date.now() + inMs;
    await p.evaluate(
      ([iso, rep, ex]) => {
        localStorage.setItem(
          "syncbiz:jingle-schedule",
          JSON.stringify([{ id: "j1", label: "J", whenLabel: "", repeatLabel: "", targetLabel: "", url: "/api/jingles/audio/j1", scheduledAtIso: iso, repeat: rep, ...(ex as object) }]),
        );
        window.dispatchEvent(new Event("syncbiz:jingle-schedule-changed"));
      },
      [new Date(at).toISOString(), repeat, extra] as const,
    );
    return at;
  };
  const sentOf = async (tabs: Page[]) => {
    let total = 0;
    for (const t of tabs) if (!t.isClosed()) total += await t.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent.length);
    return total;
  };
  const fresh = () => browser.newContext();

  try {
    // J1–J3: N tabs → exactly ONE PLAY_INTERRUPT
    for (const n of [1, 2, 3]) {
      const ctx = await fresh();
      const tabs = await openTabs(ctx, n);
      await scheduleIn(tabs[0], 1500, "daily");
      await sleep(3000);
      const sent = await sentOf(tabs);
      assert(`J${n} ${n} tab(s), daily item → exactly one PLAY_INTERRUPT`, sent === 1, `sent=${sent}`);
      await ctx.close();
    }

    // J4: "once" with 3 tabs → one fire, item removed
    {
      const ctx = await fresh();
      const tabs = await openTabs(ctx, 3);
      await scheduleIn(tabs[1], 1500, "once");
      await sleep(3000);
      const sent = await sentOf(tabs);
      const left = await tabs[2].evaluate(() => localStorage.getItem("syncbiz:jingle-schedule"));
      assert("J4 3 tabs, once item → exactly one PLAY_INTERRUPT and the item is removed", sent === 1 && left === "[]", `sent=${sent} left=${left}`);
      await ctx.close();
    }

    // J5: the scheduler tab (first opened = lock owner) closes before the fire → another tab fires once
    {
      const ctx = await fresh();
      const tabs = await openTabs(ctx, 3);
      await scheduleIn(tabs[1], 2500, "daily");
      await tabs[0].close();
      await sleep(4000);
      const sent = await sentOf(tabs);
      assert("J5 scheduler tab closed before the fire → a remaining tab takes over, fires once", sent === 1, `sent=${sent}`);
      await ctx.close();
    }

    // J6: the scheduler tab reloads right before the fire → still exactly once
    {
      const ctx = await fresh();
      const tabs = await openTabs(ctx, 2);
      const at = await scheduleIn(tabs[1], 2500, "daily");
      await sleep(at - Date.now() - 300);
      await tabs[0].reload();
      await sleep(3000);
      const sent = await sentOf(tabs);
      assert("J6 scheduler tab reloads 300 ms before the fire → exactly one PLAY_INTERRUPT", sent === 1, `sent=${sent}`);
      await ctx.close();
    }

    // J7: no MASTER at fire time (reload window / promotion) → waits, delivered ONCE when a MASTER appears
    {
      const ctx = await fresh();
      const tabs = await openTabs(ctx, 2, `${base}?master=none`);
      const at = await scheduleIn(tabs[0], 1000, "daily");
      await sleep(at - Date.now() + 3000);
      const during = await sentOf(tabs);
      for (const t of tabs) await t.evaluate(() => ((window as unknown as { __dp: { masterDeviceId: string | null } }).__dp.masterDeviceId = "master-2"));
      await sleep(1500);
      const after = await sentOf(tabs);
      const lateMs = await tabs[0].evaluate(() => (window as unknown as { __sent: { at: number }[] }).__sent[0]?.at ?? 0).then(async (a) => a || (await tabs[1].evaluate(() => (window as unknown as { __sent: { at: number }[] }).__sent[0]?.at ?? 0)));
      assert("J7 no MASTER at fire time → nothing sent while there is none", during === 0, `sent=${during}`);
      assert("J7 … delivered exactly once when a MASTER appears (3 s later)", after === 1 && lateMs - at >= 3000, `sent=${after}, ${lateMs - at} ms late`);
      await ctx.close();
    }

    // J8: MASTER never returns → gives up after the wait window, never fires later (no stale replay)
    {
      const ctx = await fresh();
      const tabs = await openTabs(ctx, 1, `${base}?master=none`);
      const at = await scheduleIn(tabs[0], 500, "daily");
      await sleep(at - Date.now() + 15_000 + 1200);
      await tabs[0].evaluate(() => ((window as unknown as { __dp: { masterDeviceId: string | null } }).__dp.masterDeviceId = "late"));
      await sleep(1500);
      const sent = await sentOf(tabs);
      assert("J8 no MASTER for > 15 s → given up, no late replay", sent === 0, `sent=${sent}`);
      await ctx.close();
    }

    // J9: desktop MASTER keeps the LOCAL MPV path (unchanged): local interrupt, no WS command
    {
      const ctx = await fresh();
      const tabs = await openTabs(ctx, 1, `${base}?desktop=1&mode=MASTER`);
      await scheduleIn(tabs[0], 1000, "daily");
      await sleep(2000);
      const local = await tabs[0].evaluate(() => (window as unknown as { __local: unknown[] }).__local.length);
      const sent = await sentOf(tabs);
      assert("J9 desktop MASTER → local MPV interrupt once, no WS command (unchanged)", local === 1 && sent === 0, `local=${local} ws=${sent}`);
      await ctx.close();
    }

    // J10: desktop renderer CONTROL (the Lenovo shape: MAIN is MASTER) → one WS command to the MASTER (unchanged)
    {
      const ctx = await fresh();
      const tabs = await openTabs(ctx, 1, `${base}?desktop=1&mode=CONTROL`);
      await scheduleIn(tabs[0], 1000, "daily");
      await sleep(2000);
      const local = await tabs[0].evaluate(() => (window as unknown as { __local: unknown[] }).__local.length);
      const sent = await sentOf(tabs);
      assert("J10 desktop renderer CONTROL (Lenovo) → one WS PLAY_INTERRUPT to the MASTER, no local MPV", sent === 1 && local === 0, `ws=${sent} local=${local}`);
      await ctx.close();
    }

    // J11: pre-roll bell → bell then jingle, once each, in order
    {
      const ctx = await fresh();
      const tabs = await openTabs(ctx, 3);
      await scheduleIn(tabs[0], 1000, "daily", { preRoll: true, bellStyle: "ding" });
      await sleep(3000);
      const all: { url: string }[] = [];
      for (const t of tabs) all.push(...(await t.evaluate(() => (window as unknown as { __sent: { url: string }[] }).__sent)));
      const urls = all.map((x) => x.url).join(" → ");
      assert("J11 pre-roll bell with 3 tabs → bell then jingle, exactly once each", all.length === 2 && /bell/.test(all[0].url) && /audio\/j1/.test(all[1].url), urls);
      await ctx.close();
    }

    // J12: no Web Locks (insecure origin) → documented fallback: previous per-tab behaviour (each tab fires)
    {
      const lan = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === "IPv4" && !a.internal)?.address;
      const ctx = await fresh();
      const tabs = await openTabs(ctx, 2, `http://${lan}:${port}/`);
      const noLocks = await tabs[0].evaluate(() => !(navigator as Navigator & { locks?: unknown }).locks);
      await scheduleIn(tabs[0], 1000, "daily");
      await sleep(2500);
      const sent = await sentOf(tabs);
      assert("J12 no Web Locks → fallback = previous behaviour (one fire per tab), never zero", noLocks && sent === 2, `noLocks=${noLocks} sent=${sent}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

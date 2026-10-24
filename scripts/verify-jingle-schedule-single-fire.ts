/**
 * F4 — a scheduled jingle fires ONCE per branch, however many tabs are open (owner 2026-10-24).
 *
 * Bundles the REAL components/jingles-control/JingleScheduleAutoPlayer.tsx (esbuild + React; the real schedule-storage
 * and lib/station-branch — the browser branch comes from localStorage `vono-control-branch` exactly as in production)
 * and replaces only `@/lib/device-player-context` with a recorder (same `sendCommandToMaster` contract: silently drops
 * the command without masterDeviceId). Serves it on a throwaway localhost page and drives real Chromium tabs that share
 * one profile's localStorage — the exact production shape.
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
    isActive: true,
    deviceMode: "CONTROL",
    masterDeviceId: "master-1",
    sendCommandToMaster(command, payload) {
      if (!this.masterDeviceId) return; // same contract as the real provider: silent no-op without a MASTER
      window.__sent.push({ command, url: payload && payload.url, at: Date.now() });
      try { localStorage.setItem("__sent:" + Math.random().toString(36).slice(2), String(Date.now())); } catch (e) {}
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
  if (params.get("active") === "0") window.__dp.isActive = false;
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
  const keyOf = (branch: string) => (branch === "default" ? "syncbiz:jingle-schedule" : `syncbiz:jingle-schedule:${branch}`);
  /** Write ONE schedule item of `branch` (shared by every tab of the profile) firing `inMs` from now. */
  const scheduleIn = async (p: Page, inMs: number, repeat: "once" | "daily", extra: Record<string, unknown> = {}, branch = "default") => {
    const at = Date.now() + inMs;
    await p.evaluate(
      ([key, iso, rep, ex]) => {
        localStorage.setItem(
          key,
          JSON.stringify([{ id: "j1", label: "J", whenLabel: "", repeatLabel: "", targetLabel: "", url: "/api/jingles/audio/j1", scheduledAtIso: iso, repeat: rep, ...(ex as object) }]),
        );
        window.dispatchEvent(new Event("syncbiz:jingle-schedule-changed"));
      },
      [keyOf(branch), new Date(at).toISOString(), repeat, extra] as const,
    );
    return at;
  };
  const stored = (p: Page, branch = "default") => p.evaluate((k) => localStorage.getItem(k), keyOf(branch));
  const setMaster = async (tabs: Page[], id: string | null) => {
    for (const t of tabs) if (!t.isClosed()) await t.evaluate((v) => ((window as unknown as { __dp: { masterDeviceId: string | null } }).__dp.masterDeviceId = v), id);
  };
  /** Sends by ANY tab of the profile, including tabs closed since (shared localStorage record). */
  const sentProfile = (p: Page) => p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("__sent:")).length);
  const sentIn = (p: Page) => p.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent.length);
  /** Sends by every tab of the profile — including tabs closed or reloaded since (shared localStorage record). */
  const sentOf = async (tabs: Page[]) => {
    const t = tabs.find((x) => !x.isClosed());
    return t ? t.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("__sent:")).length) : 0;
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

    // J13/J14 (owner edge case 1): the scheduler tab dies DURING the MASTER wait — twice — then the MASTER returns
    for (const repeat of ["once", "daily"] as const) {
      const ctx = await fresh();
      const tabs = await openTabs(ctx, 3, `${base}?master=none`);
      const at = await scheduleIn(tabs[0], 800, repeat);
      await sleep(at - Date.now() + 1500); // due, no MASTER → tabs[0] (scheduler) is waiting
      const midStored = await stored(tabs[2]);
      await tabs[0].close(); // scheduler dies mid-wait → tabs[1] takes over the SAME pending delivery
      await sleep(1500);
      await tabs[1].reload(); // the next scheduler dies too → tabs[2] (and the reloaded tab queues again)
      await setMaster([tabs[1]], null);
      await sleep(1500);
      const beforeMaster = await sentProfile(tabs[2]);
      await setMaster(tabs, "master-back"); // MASTER returns ~4.5 s after the due time (inside the 15 s window)
      await sleep(2000);
      const sent = await sentProfile(tabs[2]);
      const after = await stored(tabs[2]);
      const n = repeat === "once" ? 13 : 14;
      assert(`J${n} ${repeat}: scheduler tab dies twice during the MASTER wait → nothing sent while there is no MASTER`, beforeMaster === 0, `sent=${beforeMaster}`);
      assert(`J${n} ${repeat}: … delivered EXACTLY once when the MASTER returns (no double fire between owners)`, sent === 1, `sent=${sent}`);
      if (repeat === "once") {
        assert("J13 once: NOT removed before delivery, removed after it", !!midStored && midStored.includes('"j1"') && after === "[]", `mid=${midStored ? "present" : "missing"} after=${after}`);
      } else {
        assert("J14 daily: item kept (next occurrence tomorrow, not lost / not re-fired)", !!after && after.includes('"j1"'));
        await sleep(1500);
        assert("J14 daily: no second fire afterwards", (await sentProfile(tabs[2])) === 1);
      }
      await ctx.close();
    }

    // J15: the scheduler tab closes right AFTER delivering → the new scheduler must not send it again
    {
      const ctx = await fresh();
      const tabs = await openTabs(ctx, 2);
      const at = await scheduleIn(tabs[1], 1000, "daily");
      await sleep(at - Date.now() + 150);
      const sentByOwner = await sentIn(tabs[0]);
      await tabs[0].close();
      await sleep(2500);
      const second = await sentIn(tabs[1]);
      assert("J15 scheduler closes right after delivering → the next scheduler does not re-send", sentByOwner === 1 && second === 0, `owner=${sentByOwner} next=${second}`);
      await ctx.close();
    }

    // J16: the scheduler tab closes AT the due time (hand-over gap) → exactly once, several delays (like R1)
    {
      let okRuns = 0;
      const offsets = [-120, -40, -10, 0, 10, 40, 120];
      for (const off of offsets) {
        const ctx = await fresh();
        const tabs = await openTabs(ctx, 3);
        const at = await scheduleIn(tabs[1], 1200, "daily");
        await sleep(Math.max(0, at - Date.now() + off));
        await tabs[0].close();
        await sleep(2500);
        const sent = await sentProfile(tabs[1]);
        if (sent === 1) okRuns++;
        else console.log(`      offset ${off} ms: sent=${sent}`);
        await ctx.close();
      }
      assert(`J16 scheduler closes at the due time (offsets ${offsets.join("/")} ms) → exactly once every run`, okRuns === offsets.length, `${okRuns}/${offsets.length}`);
    }

    // J17/J18 (owner edge case 2): branch isolation in ONE profile — tab A on "default", tab B on "b2"
    {
      const ctx = await fresh();
      const [A] = await openTabs(ctx, 1); // no control branch yet → default
      await A.evaluate(() => localStorage.setItem("vono-control-branch", JSON.stringify({ branchId: "b2", label: "Branch B" })));
      const [B] = await openTabs(ctx, 1); // opened after the manager chose Branch B → b2
      await scheduleIn(B, 1000, "daily", {}, "b2"); // created in Branch B
      await sleep(2200);
      const a1 = await sentIn(A);
      const b1 = await sentIn(B);
      assert("J17 Branch B's schedule → sent once by the Branch-B tab only (A, first opened, does not take it)", a1 === 0 && b1 === 1, `A=${a1} B=${b1}`);
      await scheduleIn(A, 1000, "daily", {}, "default");
      await scheduleIn(B, 1000, "daily", { label: "J-b2" }, "b2");
      await sleep(2200);
      const a2 = (await sentIn(A)) - a1;
      const b2 = (await sentIn(B)) - b1;
      assert("J18 both branches due at the same moment → each branch's tab sends its own, once (no cross-branch block)", a2 === 1 && b2 === 1, `A=+${a2} B=+${b2}`);
      await ctx.close();
    }

    // J20: another tab writes localStorage just AFTER the due time (e.g. the other branch's scheduler firing at the
    // same moment) → the storage-change reschedule must not skip today's occurrence
    {
      let okRuns = 0;
      const offsets = [0, 1, 3, 8, 20];
      for (const off of offsets) {
        const ctx = await fresh();
        const tabs = await openTabs(ctx, 2);
        const at = await scheduleIn(tabs[1], 1000, "daily");
        await sleep(Math.max(0, at - Date.now() + off));
        await tabs[1].evaluate(() => localStorage.setItem("unrelated", String(Math.random())));
        await sleep(1500);
        const sent = await sentOf(tabs);
        if (sent === 1) okRuns++;
        else console.log(`      write +${off} ms: sent=${sent}`);
        await ctx.close();
      }
      assert(`J20 unrelated storage write right after the due time (+${offsets.join("/")} ms) → still fires once`, okRuns === offsets.length, `${okRuns}/${offsets.length}`);
    }

    // J19: a tab WITHOUT a device socket (isActive=false) opened first does not swallow the scheduler
    {
      const ctx = await fresh();
      const [D] = await openTabs(ctx, 1, `${base}?active=0`);
      const [P] = await openTabs(ctx, 1);
      await scheduleIn(P, 1000, "daily");
      await sleep(2200);
      const d = await sentIn(D);
      const pp = await sentIn(P);
      assert("J19 page without a device socket opened first → the device tab still fires once", d === 0 && pp === 1, `noSocketTab=${d} deviceTab=${pp}`);
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

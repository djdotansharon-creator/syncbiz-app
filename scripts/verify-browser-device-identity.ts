/**
 * Browser device identity (lib/device-id.ts) — one live tab = one deviceId (owner 2026-10-23).
 *
 * Bundles the REAL lib/device-id.ts with esbuild, serves it on a throwaway localhost page and drives Chromium
 * (Playwright) through every tab/window scenario, including the owner's race: the MASTER tab reloads while a new tab
 * opens at the same moment — both must end with different ids and the reloading tab must keep its id.
 *
 * Run: npx tsx scripts/verify-browser-device-identity.ts
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

type Claim = { id: string; before: string | null };

async function main() {
  const bundle = await build({
    entryPoints: [path.join(__dirname, "../lib/device-id.ts")],
    bundle: true,
    format: "iife",
    globalName: "__vonoDeviceId",
    write: false,
    platform: "browser",
  });
  const js = bundle.outputFiles[0].text;
  const html = `<!doctype html><meta charset=utf-8><title>id</title><script>${js}
    window.__before = window.__vonoDeviceId.getClaimedDeviceId();
    window.__claim = window.__vonoDeviceId.claimDeviceId();</script>`;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
  });
  await new Promise<void>((r) => server.listen(0, "0.0.0.0", () => r()));
  const port = (server.address() as { port: number }).port;
  const URL = `http://localhost:${port}/`;

  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const claim = async (p: Page): Promise<Claim> => ({
    id: await p.evaluate(() => (window as unknown as { __claim: Promise<string> }).__claim),
    before: await p.evaluate(() => (window as unknown as { __before: string | null }).__before),
  });
  const open = async (ctx: BrowserContext): Promise<Page> => {
    const p = await ctx.newPage();
    await p.goto(URL);
    return p;
  };

  try {
    // ── one browser profile ──
    const ctx = await browser.newContext();
    const A = await open(ctx);
    const a1 = await claim(A);
    const stable = await A.evaluate(() => localStorage.getItem("device_id"));
    assert("I0 no id is exposed before the claim resolves", a1.before === null);
    assert("I1 first tab claims the profile's stable id (today's identity)", a1.id === stable, a1.id);

    await A.reload();
    const a2 = await claim(A);
    assert("I2 refresh of the same tab → same id", a2.id === a1.id);

    const B = await open(ctx);
    const b1 = await claim(B);
    assert("I3 new tab → a different id", b1.id !== a1.id);
    await B.reload();
    const b2 = await claim(B);
    assert("I4 refresh of the second tab → its own id again", b2.id === b1.id);

    const ss = await A.evaluate(() => JSON.stringify(sessionStorage));
    const D = await ctx.newPage();
    await D.addInitScript((s: string) => {
      const o = JSON.parse(s) as Record<string, string>;
      for (const k of Object.keys(o)) sessionStorage.setItem(k, o[k]);
    }, ss);
    await D.goto(URL);
    const d1 = await claim(D);
    assert("I5 duplicated tab (sessionStorage cloned) → a different id", d1.id !== a1.id && d1.id !== b1.id);

    const [W] = await Promise.all([ctx.waitForEvent("page"), A.evaluate((u) => void window.open(u), URL)]);
    await W.waitForLoadState();
    const copied = await W.evaluate(() => !!sessionStorage.getItem("vono_tab_device_id"));
    const w1 = await claim(W);
    assert("I6 window.open (sessionStorage copied) → a different id", w1.id !== a1.id, `copied=${copied}`);

    const [N] = await Promise.all([ctx.waitForEvent("page"), A.evaluate((u) => void window.open(u, "_blank", "noopener"), URL)]);
    await N.waitForLoadState();
    const n1 = await claim(N);
    assert("I7 window.open noopener → a different id", n1.id !== a1.id);

    const live = [a2.id, b2.id, d1.id, w1.id, n1.id];
    assert("I8 every live tab has a unique id", new Set(live).size === live.length, `${live.length} tabs`);

    // ── the owner's race: MASTER (stable) tab reloads while a new tab opens at the same moment ──
    let raceOk = 0;
    const RUNS = 8;
    for (let i = 0; i < RUNS; i++) {
      const delay = [0, 5, 15, 30, 60, 0, 10, 25][i];
      const [, fresh] = await Promise.all([
        A.reload(),
        (async () => {
          await new Promise((r) => setTimeout(r, delay));
          return open(ctx);
        })(),
      ]);
      const aR = await claim(A);
      const fR = await claim(fresh);
      if (aR.id === a1.id && fR.id !== aR.id) raceOk++;
      else console.log(`      race ${i}: A=${aR.id.slice(0, 8)} (want ${a1.id.slice(0, 8)}), new=${fR.id.slice(0, 8)}`);
      await fresh.close();
    }
    assert(`R1 MASTER reload + new tab at the same time → reloaded tab keeps its id, new tab differs (${RUNS} runs)`, raceOk === RUNS, `${raceOk}/${RUNS}`);

    // ── the stable owner closes for good: once its handoff marker is stale a NEW tab may take the stable id ──
    await A.close();
    await D.close();
    await W.close();
    await N.close();
    await B.evaluate(() => localStorage.setItem("vono_device_handoff", JSON.stringify({ id: localStorage.getItem("device_id"), at: Date.now() - 60_000 })));
    const C = await open(ctx);
    const c1 = await claim(C);
    assert("I9 stable owner closed (stale handoff) → a new tab may reuse the stable id", c1.id === a1.id);
    await B.reload();
    const b3 = await claim(B);
    assert("I10 the other tab's refresh keeps its own id", b3.id === b1.id && b3.id !== c1.id);
    await ctx.close();

    // ── no Web Locks: fail-safe unique per page, never shared ──
    // Web Locks exist only on SECURE origins: the same page over plain http on a non-loopback address is exactly a
    // browser without the API.
    const lan = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === "IPv4" && !a.internal)?.address;
    const nl = await browser.newContext();
    const openInsecure = async (): Promise<Page> => {
      const p = await nl.newPage();
      await p.goto(`http://${lan}:${port}/`);
      return p;
    };
    const X = await openInsecure();
    const Y = await openInsecure();
    const locksGone = await X.evaluate(() => !(navigator as Navigator & { locks?: unknown }).locks);
    assert("F0 (setup) Web Locks really unavailable in this context", !!lan && locksGone, `origin http://${lan}`);
    const x1 = await claim(X);
    const y1 = await claim(Y);
    assert("F1 no Web Locks → two live tabs still get different ids", x1.id !== y1.id);
    const stableNl = await X.evaluate(() => localStorage.getItem("device_id"));
    assert("F2 no Web Locks → the shared profile id is NOT used", x1.id !== stableNl && y1.id !== stableNl);
    await nl.close();
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

/**
 * The player's "Update" link (owner 2026-11-02 / 2026-11-27): an engine that can update itself does it in place; an older engine follows the link as before;
 * and when the in-place update did NOTHING (`unsupported` / `no_info`) the link is opened so the click is never a dead end.
 * Run: npx tsx scripts/verify-update-click.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { needsLinkFallback, startDesktopUpdate } from "../lib/start-desktop-update";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const ROOT = path.join(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

assert("F1 only 'nothing was done' answers need the link", needsLinkFallback({ ok: false, reason: "unsupported" }) && needsLinkFallback({ ok: false, reason: "no_info" }));
assert("F2 an update that started, or one that already offered the link itself, or one that must stay silent, never opens it twice",
  !needsLinkFallback({ ok: true }) && !needsLinkFallback({ ok: false, reason: "download_failed" }) && !needsLinkFallback({ ok: false, reason: "hash_mismatch" }) &&
  !needsLinkFallback({ ok: false, reason: "no_hash" }) && !needsLinkFallback({ ok: false, reason: "run_failed" }) && !needsLinkFallback({ ok: false, reason: "not_newer" }) &&
  !needsLinkFallback({ ok: false, reason: "busy" }) && !needsLinkFallback(undefined) && !needsLinkFallback(null));

async function scenario(bridge: unknown): Promise<{ handled: boolean; calls: number; opened: string[] }> {
  const opened: string[] = [];
  let calls = 0;
  const w = globalThis as unknown as { window?: unknown };
  const real = bridge && typeof bridge === "object" && "startUpdate" in (bridge as object)
    ? { startUpdate: () => { calls++; return (bridge as { startUpdate: () => Promise<unknown> }).startUpdate(); } }
    : bridge;
  w.window = { syncbizDesktop: real, open: (u: string) => { opened.push(u); } };
  const handled = startDesktopUpdate("https://example.test/installer");
  await new Promise((r) => setTimeout(r, 20));
  delete w.window;
  return { handled, calls, opened };
}
(async () => {
  const none = await scenario({});
  assert("B1 an engine without startUpdate: the click is NOT handled (the link works as it always did)", !none.handled && none.calls === 0 && none.opened.length === 0);
  const noBridge = await scenario(undefined);
  assert("B2 not the desktop app: not handled", !noBridge.handled && noBridge.calls === 0);
  const ok = await scenario({ startUpdate: async () => ({ ok: true }) });
  assert("B3 an update that starts: handled, startUpdate called once, the browser NOT opened", ok.handled && ok.calls === 1 && ok.opened.length === 0);
  const nothing = await scenario({ startUpdate: async () => ({ ok: false, reason: "no_info" }) });
  assert("B4 'no_info': handled, then the link opens in the browser (never a dead click)", nothing.handled && nothing.calls === 1 && nothing.opened.join() === "https://example.test/installer");
  const unsup = await scenario({ startUpdate: async () => ({ ok: false, reason: "unsupported" }) });
  assert("B5 'unsupported': the link opens", unsup.handled && unsup.opened.length === 1);
  const dl = await scenario({ startUpdate: async () => ({ ok: false, reason: "download_failed" }) });
  assert("B6 a download failure: the engine already offered the link, so the page opens nothing second", dl.handled && dl.opened.length === 0);
  const boom = await scenario({ startUpdate: async () => { throw new Error("ipc"); } });
  assert("B7 the bridge throws: the link opens (never a dead click)", boom.handled && boom.opened.length === 1);

  const pill = read("components/desktop-update-pill.tsx"), det = read("components/device-details.tsx");
  assert("W1 the pill's Update link and the device-details link both go through startDesktopUpdate and only then preventDefault", /if \(startDesktopUpdate\(target\.href\)\) e\.preventDefault\(\);/.test(pill) && /if \(startDesktopUpdate\(engine\.href \?\? [^)]*\)\) e\.preventDefault\(\);/.test(det));
  console.log(`\n${pass} passed, ${fail} failed`);
})();

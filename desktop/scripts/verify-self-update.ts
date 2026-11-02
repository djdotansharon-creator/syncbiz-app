/**
 * Player self-update (owner 2026-11-02): the pure flow with fake dependencies — no window, no network, no installer is ever started here.
 * The real Windows behaviour (silent installer, relaunch) is proven only on the Lenovo.
 * Run (from desktop/): npx tsx scripts/verify-self-update.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { INSTALLER_ARGS, isNewerVersion, performSelfUpdate, resetSelfUpdateBusy, type SelfUpdateDeps, type UpdateInfo } from "../src/main/self-update-core";
import { updateWindowHtml } from "../src/main/self-update-window-html";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const HASH = "a".repeat(64);
const URL_ = "https://site.example/api/desktop/installer";

function fake(over: Partial<SelfUpdateDeps> = {}, info: UpdateInfo | null = { version: "2.3.2", installerUrl: URL_, sha256: HASH }) {
  const calls: string[] = [];
  const deps: SelfUpdateDeps = {
    fetchInfo: async () => { calls.push("info"); return info; },
    showWindow: (v) => { calls.push("window:" + v); },
    closeWindow: () => { calls.push("close"); },
    tempPath: (v) => `/tmp/vono-update/VONO-Player-Setup-${v}-x64.exe`,
    download: async (u, d) => { calls.push(`download:${u}->${d}`); },
    sha256File: async () => { calls.push("hash"); return HASH; },
    removeFile: async (p) => { calls.push("remove:" + p); },
    runInstaller: async (p) => { calls.push("run:" + p); },
    openInBrowser: (u) => { calls.push("browser:" + u); },
    log: () => undefined,
    ...over,
  };
  return { deps, calls };
}

(async () => {
  // S1 happy path
  { resetSelfUpdateBusy(); const { deps, calls } = fake(); const r = await performSelfUpdate(deps, "2.3.1");
    assert("S1 newer + hash matches → window, download, verify, THEN the installer runs (in that order); the window stays; no browser fallback",
      r.ok === true && calls.join("|") === `info|window:2.3.2|download:${URL_}->/tmp/vono-update/VONO-Player-Setup-2.3.2-x64.exe|hash|run:/tmp/vono-update/VONO-Player-Setup-2.3.2-x64.exe`, calls.join("|"));
    assert("S1b the installer runs silently, relaunches the player, and is told it is an update", INSTALLER_ARGS.join(" ") === "/S --updated --force-run");
    const again = await performSelfUpdate(fake().deps, "2.3.1");
    assert("S1c after a successful start it stays busy (the installer is taking over) until released", again.ok === false && (again as { reason: string }).reason === "busy");
    resetSelfUpdateBusy(); }
  // S2 hash mismatch — the installer must NEVER run
  { resetSelfUpdateBusy(); const { deps, calls } = fake({ sha256File: async () => { calls.push("hash"); return "b".repeat(64); } }); const r = await performSelfUpdate(deps, "2.3.1");
    assert("S2 a download whose SHA-256 differs is NEVER run: file removed, window closed, the browser link offered", r.ok === false && (r as { reason: string }).reason === "hash_mismatch" && !calls.some((c) => c.startsWith("run:")) && calls.some((c) => c.startsWith("remove:")) && calls.includes("close") && calls.includes("browser:" + URL_), calls.join("|")); }
  // S3 no published hash
  { resetSelfUpdateBusy(); const { deps, calls } = fake({}, { version: "2.3.2", installerUrl: URL_, sha256: null }); const r = await performSelfUpdate(deps, "2.3.1");
    assert("S3 no published SHA-256 → nothing is downloaded or run (no window); the person gets the manual download", r.ok === false && (r as { reason: string }).reason === "no_hash" && !calls.some((c) => c.startsWith("download") || c.startsWith("run:") || c.startsWith("window")) && calls.includes("browser:" + URL_)); }
  { resetSelfUpdateBusy(); const r = await performSelfUpdate(fake({}, { version: "2.3.2", installerUrl: URL_, sha256: "nothex" }).deps, "2.3.1");
    assert("S3b a malformed hash counts as no hash", (r as { reason: string }).reason === "no_hash"); }
  // S4 not newer
  for (const [latest, cur] of [["2.3.1", "2.3.1"], ["2.3.0", "2.3.1"]] as const) {
    resetSelfUpdateBusy(); const { deps, calls } = fake({}, { version: latest, installerUrl: URL_, sha256: HASH }); const r = await performSelfUpdate(deps, cur);
    assert(`S4 latest ${latest} vs running ${cur} → nothing happens (no window, no download, no browser)`, r.ok === false && (r as { reason: string }).reason === "not_newer" && calls.join("|") === "info"); }
  assert("S4b version rule: 2.3.2 > 2.3.1 > 2.2.8-beta.21; equal / garbage never newer", isNewerVersion("2.3.2", "2.3.1") && isNewerVersion("2.3.1", "2.2.8-beta.21") && !isNewerVersion("2.3.1", "2.3.1") && !isNewerVersion("x", "2.3.1"));
  // S5 download fails
  { resetSelfUpdateBusy(); const { deps, calls } = fake({ download: async () => { throw new Error("HTTP 503"); } }); const r = await performSelfUpdate(deps, "2.3.1");
    assert("S5 a failed download closes the window, never runs anything and offers the browser link", (r as { reason: string }).reason === "download_failed" && !calls.some((c) => c.startsWith("run:")) && calls.includes("close") && calls.includes("browser:" + URL_)); }
  // S6 busy
  { resetSelfUpdateBusy(); let release: () => void = () => undefined; const gate = new Promise<void>((res) => { release = res; });
    const slow = fake({ download: async () => { await gate; } }); const first = performSelfUpdate(slow.deps, "2.3.1"); await new Promise((r) => setTimeout(r, 5));
    const second = await performSelfUpdate(fake().deps, "2.3.1");
    assert("S6 a second click while one update is running is ignored (single flight)", second.ok === false && (second as { reason: string }).reason === "busy");
    release(); await first; resetSelfUpdateBusy(); }
  // S7 installer cannot start
  { resetSelfUpdateBusy(); const { deps, calls } = fake({ runInstaller: async () => { throw new Error("spawn EACCES"); } }); const r = await performSelfUpdate(deps, "2.3.1");
    assert("S7 an installer that cannot start → window closed, file removed, browser link offered, and a retry is possible", (r as { reason: string }).reason === "run_failed" && calls.includes("close") && calls.some((c) => c.startsWith("remove:")) && calls.includes("browser:" + URL_) && (await performSelfUpdate(fake().deps, "2.3.1")).ok === true);
    resetSelfUpdateBusy(); }
  // S8 info unreachable
  { resetSelfUpdateBusy(); const { deps, calls } = fake({}, null); const r = await performSelfUpdate(deps, "2.3.1");
    assert("S8 the site cannot be read → nothing happens (no window, no browser)", (r as { reason: string }).reason === "no_info" && calls.join("|") === "info"); }
  // S9 hash comparison is case-insensitive
  { resetSelfUpdateBusy(); const { deps } = fake({ sha256File: async () => HASH.toUpperCase() }, { version: "2.3.2", installerUrl: URL_, sha256: ` ${HASH.toUpperCase()} ` }); const r = await performSelfUpdate(deps, "2.3.1");
    assert("S9 upper / lower case and spaces in the hash do not matter", r.ok === true); resetSelfUpdateBusy(); }

  // ── the window ──
  const html = updateWindowHtml("2.3.2");
  assert("W1 the window: white rounded card, 'VONO' + the version, one black moving bar — no percentage, no border, no extra text",
    /background:#fff;border-radius:18px/.test(html) && />VONO<\/b><span>2\.3\.2<\/span>/.test(html) && /background:#111;animation:run/.test(html) && !/%</.test(html.replace(/width:38%|width:100%|height:100%|left:-40%|left:102%|0%\{|100%\{/g, "")) && !/border:/.test(html) && !/<(p|h1|h2|button|a)\b/.test(html));
  assert("W2 the version is escaped (nothing a site could send runs inside the window)", !/<script|<img/.test(updateWindowHtml('<img src=x onerror=1>')) && /&lt;img/.test(updateWindowHtml('<img src=x onerror=1>')));

  // ── static pins on the wiring ──
  const rd = (p: string) => readFileSync(path.join(__dirname, "..", "..", p), "utf-8").replace(/\r\n/g, "\n");
  const wiring = rd("desktop/src/main/self-update.ts");
  assert("P1 the installer is started detached, no shell, output ignored, and the app is NOT quit by the updater (the installer's pre-flight stops it — same as a manual install)", /spawn\(file, \[\.\.\.INSTALLER_ARGS\], \{ detached: true, stdio: "ignore", windowsHide: true \}\)/.test(wiring) && !/shell: true/.test(wiring) && !/app\.quit|app\.exit/.test(wiring));
  assert("P2 only a packaged Windows app updates itself (anything else answers `unsupported`)", /process\.platform !== "win32" \|\| !app\.isPackaged\) return \{ ok: false, reason: "unsupported" \}/.test(wiring));
  assert("P3 the update source is the site the player is pinned to and must be https", /SYNCBIZ_HOSTED_WEB_APP_URL/.test(wiring) && /\^https:\\\/\\\/\/i\.test\(installerUrl\)/.test(wiring));
  assert("P4 IPC: START_UPDATE constant → handler → preload → renderer API type", /START_UPDATE: "mvp:start-update"/.test(rd("desktop/src/shared/mvp-types.ts")) && /MVP_IPC\.START_UPDATE, \(\) => startSelfUpdate\(\)/.test(rd("desktop/src/main/ipc-mvp.ts")) && /startUpdate: \(\)/.test(rd("desktop/src/preload/index.ts")) && /startUpdate: \(\) => Promise/.test(rd("desktop/src/shared/mvp-desktop-api.ts")));
  assert("P5 nothing in the update touches playback / MPV / the WS manager", !/orchestrator|mpv|device-ws|playback/i.test((rd("desktop/src/main/self-update-core.ts") + wiring).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
  console.log(`\n${pass} passed, ${fail} failed`);
})();

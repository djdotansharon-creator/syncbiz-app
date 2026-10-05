/*
 * PHASE 1 PROOF (manual, real Electron) — offline cold-boot renderer cache assumptions.
 *
 *   npx electron scripts/electron-proof-offline-cache.cjs origin   (B: same-origin protocol.handle interception)
 *   npx electron scripts/electron-proof-offline-cache.cjs fetch    (A: defaultSession.fetch carries the auth context)
 *
 * TEST environment ONLY. Uses a THROWAWAY userData profile (never the real VONO profile). Prints NO cookie/token
 * values — only booleans, status codes and origins. Deletes the profile at the end unless KEEP_PROFILE=1.
 */
const { app, BrowserWindow, protocol, net, session } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const crypto = require("node:crypto");

const HOSTED = "https://syncbiz-app-test-production.up.railway.app";
const MODE = process.argv[process.argv.length - 1];
const PROFILE = process.env.PROOF_PROFILE || path.join(os.tmpdir(), "vono-offline-cache-proof");
app.setPath("userData", PROFILE);

const out = { mode: MODE };
const done = (code) => {
  console.log("PROOF_RESULT " + JSON.stringify(out));
  if (process.env.KEEP_PROFILE !== "1") {
    app.once("quit", () => { try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* ignore */ } });
  }
  app.exit(code);
};

async function proveOrigin() {
  const nonce = crypto.randomBytes(8).toString("hex");
  const seen = { intercepted: 0, passthroughHosted: 0, passthroughForeign: 0 };
  const PAGE = `<!doctype html><html><body>proof<script>
    localStorage.setItem("vono-offline-proof", ${JSON.stringify(nonce)});
    window.__proof = { origin: location.origin, href: location.href, img: null, api: null };
    const img = new Image(); img.onload = () => window.__proof.img = "ok"; img.onerror = () => window.__proof.img = "error";
    img.src = "https://www.google.com/favicon.ico?vono=" + Date.now();
    fetch("/api/health", { cache: "no-store" }).then(r => window.__proof.api = r.status).catch(e => window.__proof.api = "error");
  </script></body></html>`;

  // Scoped interception: ONLY the hosted /sources document is served from "cache"; everything else (hosted /api,
  // foreign origins) is passed through to the real network untouched.
  protocol.handle("https", (req) => {
    const u = new URL(req.url);
    if (u.origin === HOSTED && u.pathname === "/sources") {
      seen.intercepted++;
      return new Response(PAGE, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (u.origin === HOSTED) seen.passthroughHosted++; else seen.passthroughForeign++;
    return net.fetch(req, { bypassCustomProtocolHandlers: true });
  });

  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await win.loadURL(HOSTED + "/sources");
  await new Promise((r) => setTimeout(r, 4000));
  const a = await win.webContents.executeJavaScript("window.__proof");
  out.intercepted = { origin: a.origin, href: a.href, foreignImg: a.img, hostedApiStatus: a.api, counts: { ...seen } };

  // Stop intercepting → load a REAL live hosted page from the network and read the same key.
  protocol.unhandle("https");
  const before = seen.intercepted;
  await win.loadURL(HOSTED + "/login");
  const b = await win.webContents.executeJavaScript(
    `({ origin: location.origin, sameKey: localStorage.getItem("vono-offline-proof") === ${JSON.stringify(nonce)} })`,
  );
  await win.webContents.executeJavaScript(`localStorage.removeItem("vono-offline-proof")`);
  out.live = { origin: b.origin, sameLocalStorageKeyVisible: b.sameKey, interceptedAfterUnhandle: seen.intercepted - before };

  out.PASS =
    a.origin === HOSTED &&
    seen.intercepted === 1 &&
    a.img === "ok" &&
    a.api === 200 &&
    b.origin === HOSTED &&
    b.sameKey === true &&
    seen.intercepted - before === 0;
  done(out.PASS ? 0 : 1);
}

async function proveFetch() {
  const ses = session.defaultSession;
  const hasSession = async () =>
    (await ses.cookies.get({ url: HOSTED, name: "syncbiz-session" })).length > 0;

  if (!(await hasSession())) {
    // One-time human login in a VISIBLE window on the TEST origin. The script never reads the credentials.
    const win = new BrowserWindow({ width: 900, height: 760, title: "VONO proof — sign in to TEST", show: true });
    await win.loadURL(HOSTED + "/login?from=%2Fsources");
    const deadline = Date.now() + 15 * 60_000;
    while (!(await hasSession())) {
      if (Date.now() > deadline) { out.error = "login timeout"; return done(2); }
      await new Promise((r) => setTimeout(r, 1500));
    }
    win.close();
  }
  out.sessionCookiePresent = true; // presence only — value never read or printed

  const res = await ses.fetch(HOSTED + "/sources", { redirect: "manual", cache: "no-store" });
  const body = res.status === 200 ? await res.text() : "";
  out.status = res.status;
  out.redirectedTo = res.headers.get("location") ? new URL(res.headers.get("location"), HOSTED).pathname : null;
  out.isHtml = (res.headers.get("content-type") || "").includes("text/html");
  out.looksAuthenticatedWorkspace = res.status === 200 && /_next\/static\//.test(body) && !/\/login/.test(out.redirectedTo || "");
  out.setCookieHeaderPresent = res.headers.has("set-cookie"); // must not be stored by the cache — boolean only

  // Control: the same fetch from a FRESH in-memory session (no cookies) must NOT get the workspace document.
  const anon = session.fromPartition("vono-proof-anon-" + Date.now());
  // Electron's fetch REJECTS a manual-mode redirect ("Redirect was cancelled") instead of returning it, so a
  // rejection here IS the unauthenticated middleware redirect (→ /login). Either way it must not be a 200 document.
  try {
    const r2 = await anon.fetch(HOSTED + "/sources", { redirect: "manual", cache: "no-store" });
    out.anonStatus = r2.status;
  } catch (e) {
    out.anonStatus = /redirect/i.test(String(e && e.message)) ? "redirect(cancelled)" : "error";
  }
  // Follow mode shows WHERE the unauthenticated request ends up (expected: /login).
  const r3 = await anon.fetch(HOSTED + "/sources", { cache: "no-store" });
  // Electron's fetch may leave Response.url empty after following redirects → fall back to recognising the login
  // page by its password field.
  const anonBody = await r3.text();
  out.anonFinalPath = r3.url ? new URL(r3.url).pathname : /id="password"/.test(anonBody) ? "/login" : "unknown";

  out.PASS =
    out.status === 200 && out.isHtml && out.looksAuthenticatedWorkspace && out.anonStatus !== 200 && out.anonFinalPath === "/login";
  done(out.PASS ? 0 : 1);
}

/*
 * E2E (needs a TEST-session profile from `fetch` mode + `npx tsc` build of dist/):
 * real compiled RendererOfflineCache + real TEST renderer:
 *   online load "/" (unchanged path) → passive observe → capture → session network emulation OFFLINE → load "/" →
 *   did-fail-load network-class → validate → enableOfflineServing → load /sources from cache → renderer boots on the
 *   SAME origin and reaches its restore path → network back → interceptor removed WITHOUT a reload.
 * A fake preload bridge reports the offline designated-station state (designatedStationOffline:true) and records
 * calls by NAME only. The seeded snapshot uses a non-existent placeholder path (never a real file).
 */
async function proveE2E() {
  const { ipcMain } = require("electron");
  const { RendererOfflineCache, isNetworkClassLoadError, OFFLINE_ROUTE } = require("../dist/main/renderer-offline-cache.js");
  const ses = session.defaultSession;
  const logs = [];
  const cache = new RendererOfflineCache(
    { ses, protocol, net, userData: app.getPath("userData"), hostedUrl: HOSTED + "/", log: (l, m, d) => logs.push(`${l} ${m} ${d ? JSON.stringify(d) : ""}`) },
    { settleMs: 8000, healthMs: 5000 },
  );
  cache.attachObserver();

  const preload = path.join(PROFILE, "proof-preload.js");
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.writeFileSync(preload, `
    const { contextBridge, ipcRenderer } = require("electron");
    const snap = { wsState: "disconnected", registered: false, deviceRole: "unknown", commandReady: false, designatedStationOffline: true, mockPlaybackStatus: "idle", mockVolume: 80 };
    const rec = (name) => (...a) => { ipcRenderer.send("proof-call", name, a.map((x) => typeof x === "string" && x.includes("vono-proof-fake") ? "FAKE_LOCAL_PATH" : typeof x)); };
    const api = {};
    for (const n of ["mpvPlayUrl","mpvSeekTo","mpvPause","mpvResume","mpvStop","setMixDuration","localMockTransport","mpvPlayInterrupt","sendCommand"]) api[n] = (...a) => { rec(n)(...a); return Promise.resolve({ ok: true }); };
    api.getStatus = () => { rec("getStatus")(); return Promise.resolve(snap); };
    api.getConfig = () => { rec("getConfig")(); return Promise.resolve({ deviceId: "", branchId: "default", wsUrl: "", wsToken: "" }); };
    api.getAppVersion = () => Promise.resolve("proof");
    api.applyDesktopAuth = () => { rec("applyDesktopAuth")(); return Promise.resolve({ ok: false }); };
    api.onStatus = (cb) => { rec("onStatus")(); setTimeout(() => cb(snap), 0); return () => {}; };
    contextBridge.exposeInMainWorld("syncbizDesktop", api);
  `);
  const calls = [];
  ipcMain.on("proof-call", (_e, name, kinds) => calls.push(`${name}(${kinds.join(",")})`));

  const win = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false } });
  const consoleHits = [];
  win.webContents.on("console-message", (_e, _l, msg) => {
    if (/LocalResume Diag\] restore-load|restore reconstruct|desktop_mpv_url_dispatch|SB-DIAG unified\] fetch FAILED/.test(msg)) consoleHits.push(msg.replace(/[A-Za-z]:\\[^\s"]*/g, "<path>").slice(0, 160));
  });
  let finishLoads = 0;
  win.webContents.on("did-finish-load", () => {
    finishLoads++;
    const u = win.webContents.getURL();
    if (/^https?:\/\//.test(u)) cache.onMainFrameLoaded(u);
  });
  let failCode = null;
  win.webContents.on("did-fail-load", (_e, code, _d, _u, isMain) => {
    if (!isMain || code === -3) return;
    failCode = code;
    if (!cache.isServingOffline && isNetworkClassLoadError(code)) {
      const v = cache.validate();
      out.offlineValidation = v.ok ? "ok" : v.reason;
      if (v.ok) { cache.enableOfflineServing(v); void win.webContents.loadURL(cache.origin + OFFLINE_ROUTE); }
    }
  });

  // 1) ONLINE — the unchanged startup URL "/" (middleware redirects a signed-in session to /sources).
  await win.loadURL(HOSTED + "/");
  out.onlineFinalPath = new URL(win.webContents.getURL()).pathname;
  const tc = Date.now();
  while (!cache.validate().ok && Date.now() - tc < 45000) await new Promise((r) => setTimeout(r, 1000)); // settle (8s) + capture
  const v0 = cache.validate();
  out.captured = v0.ok ? { files: v0.manifest.files.length, hasDoc: v0.manifest.files.some((f) => f.url === HOSTED + "/sources") } : v0.reason;
  out.cachedAnyApi = v0.ok ? v0.manifest.files.some((f) => new URL(f.url).pathname.startsWith("/api/")) : null;

  // Seed a recovery snapshot (placeholder path) on a same-origin page with no app scripts.
  await win.loadURL(HOSTED + "/manifest.webmanifest");
  await win.webContents.executeJavaScript(`localStorage.setItem("syncbiz-playback-recovery-v2", JSON.stringify({
    currentSourceId: "playnext-proof", queueIds: ["playnext-proof"], queueIndex: 0, trackIndex: 0, status: "playing", volume: 70,
    positionSeconds: 5, updatedAt: Date.now(), local: { currentUrl: "C:\\\\vono-proof-fake\\\\t1.mp3", title: "Proof" } }))`);

  // 2) OFFLINE COLD BOOT — the whole session (renderer AND MAIN net.fetch probe) loses the network: route all
  // traffic through an unreachable proxy (real connection failure, no HTTP cache served for no-store documents).
  await ses.setProxy({ proxyRules: "http=127.0.0.1:9;https=127.0.0.1:9" });
  await ses.closeAllConnections();
  finishLoads = 0;
  await win.loadURL(HOSTED + "/").catch(() => {});
  await new Promise((r) => setTimeout(r, 15000));
  out.offline = {
    firstFailCode: failCode,
    servingOffline: cache.isServingOffline,
    page: await win.webContents.executeJavaScript(
      `({ origin: location.origin, path: location.pathname, deck: !!document.querySelector("[class*=deck],[class*=player]"), login: location.pathname === "/login" })`,
    ),
    restoreConsole: consoleHits.slice(0, 6),
    bridgeCalls: [...new Set(calls)],
  };
  await win.webContents.executeJavaScript(`window.__noReloadMarker = 1`);
  const loadsBefore = finishLoads;

  // 3) INTERNET RETURNS — interceptor must be removed with NO renderer reload.
  await ses.setProxy({ mode: "direct" });
  const t0 = Date.now();
  while (cache.isServingOffline && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 500));
  await new Promise((r) => setTimeout(r, 2000));
  out.internetReturn = {
    interceptorRemoved: !cache.isServingOffline,
    noReload: (await win.webContents.executeJavaScript(`window.__noReloadMarker === 1`)) && finishLoads === loadsBefore,
  };
  await win.loadURL(HOSTED + "/manifest.webmanifest");
  await win.webContents.executeJavaScript(`localStorage.removeItem("syncbiz-playback-recovery-v2")`);
  out.logs = logs.map((l) => l.slice(0, 160));

  out.PASS =
    out.onlineFinalPath === "/sources" && out.captured && out.captured.hasDoc && out.cachedAnyApi === false &&
    out.offline.servingOffline === true && out.offline.page.origin === HOSTED && out.offline.page.path === "/sources" &&
    out.offline.page.deck && !out.offline.page.login &&
    out.offline.restoreConsole.some((m) => /restore-load/.test(m)) &&
    out.offline.bridgeCalls.some((c) => c.startsWith("mpvPlayUrl(FAKE_LOCAL_PATH")) &&
    out.internetReturn.interceptorRemoved && out.internetReturn.noReload;
  done(out.PASS ? 0 : 1);
}

// The proof decides when to exit (done()); closing the login window must not quit Electron early.
app.on("window-all-closed", () => {});

app.whenReady().then(() => (MODE === "fetch" ? proveFetch() : MODE === "e2e" ? proveE2E() : proveOrigin())).catch((e) => {
  out.error = String(e && e.message);
  done(3);
});

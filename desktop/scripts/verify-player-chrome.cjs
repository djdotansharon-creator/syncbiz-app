/**
 * Headless Electron check: hero matches web `/player` (inline transport + volume), full footer dock,
 * and deck meta strip. Run from desktop/: npm run build && npm run verify:player-chrome
 */
const path = require("path");
const { app, BrowserWindow } = require("electron");
const { registerMvpIpc } = require(path.join(__dirname, "..", "dist", "main", "ipc-mvp.js"));

const rootDir = path.join(__dirname, "..");
app.setPath("userData", path.join(rootDir, ".verify-player-chrome-userdata"));

let win = null;
function getWindow() {
  return win;
}

app.whenReady().then(() => {
  registerMvpIpc(getWindow);
  win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(rootDir, "dist", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.webContents.on("did-fail-load", (event, errorCode, errorDescription, validatedURL) => {
    console.error("[verify-player-chrome] did-fail-load:", errorCode, errorDescription, validatedURL);
  });
  win.webContents.on("console-message", (_e, level, message) => {
    console.log("[renderer console]", level, message);
  });

  win.loadFile(path.join(rootDir, "dist", "renderer", "index.html"));

  win.webContents.on("did-finish-load", () => {
    setTimeout(async () => {
      try {
        const pre = await win.webContents.executeJavaScript(`(() => ({
          hasApi: typeof window.syncbizDesktop !== "undefined",
          ready: document.readyState,
          heroLen: (document.getElementById("playerHeroRoot") || {}).innerHTML?.length ?? -1
        }))()`);
        console.log("[verify-player-chrome] pre-check:", JSON.stringify(pre));

        const r = await win.webContents.executeJavaScript(`(() => {
          const el = document.getElementById("playerHeroRoot");
          if (!el) return { ok: false, step: "missing #playerHeroRoot" };
          const inner = el.querySelector(".sb-phs-root");
          if (!inner) return { ok: false, step: "missing .sb-phs-root", snippet: el.innerHTML.slice(0, 300) };
          const deckEl = document.getElementById("playerDeckMetaRoot");
          if (!deckEl) return { ok: false, step: "missing #playerDeckMetaRoot" };
          const deckInner = deckEl.querySelector(".sb-pdms-root");
          if (!deckInner) return { ok: false, step: "missing .sb-pdms-root", snippet: deckEl.innerHTML.slice(0, 300) };
          const dockRoot = document.getElementById("playbackDockRoot");
          if (!dockRoot) return { ok: false, step: "missing #playbackDockRoot" };
          const heroTransport = !!inner.querySelector(".sb-phs-transport");
          const heroVol = !!inner.querySelector(".sb-phs-vol");
          const heroPlay = !!inner.querySelector(".sb-phs-tbtn-play");
          const dockTransport = !!dockRoot.querySelector(".sb-pds-transport");
          const dockVol = !!dockRoot.querySelector(".sb-pds-vol");
          const dockPlay = !!dockRoot.querySelector(".sb-pds-btn-play");
          const transportOk = heroTransport && dockTransport;
          const volumeOk = heroVol && dockVol;
          const checks = {
            eyebrow: !!inner.querySelector(".sb-phs-eyebrow"),
            title: !!inner.querySelector(".sb-phs-title"),
            provider: !!inner.querySelector(".sb-phs-provider"),
            detail: !!inner.querySelector(".sb-phs-detail"),
            statusPill: !!inner.querySelector(".sb-phs-pill"),
            transportOk,
            volumeOk,
            heroTransport,
            heroVol,
            heroPlay,
            dockTransport,
            dockVol,
            dockPlay,
            deckMeta: !!deckInner.querySelector(".sb-pdms-panel"),
            deckTimeline: !!deckInner.querySelector(".sb-pdms-timeline"),
          };
          const all = Object.values(checks).every(Boolean);
          return {
            ok: all,
            checks,
            preview: (inner.innerText || "").slice(0, 500),
          };
        })()`);

        console.log(JSON.stringify(r, null, 2));
        if (!r.ok) {
          console.error("[verify-player-chrome] FAILED:", r.step || r.checks);
          app.exit(1);
          return;
        }
        const c = r.checks;
        if (
          !c.eyebrow ||
          !c.title ||
          !c.provider ||
          !c.detail ||
          !c.statusPill ||
          !c.transportOk ||
          !c.volumeOk ||
          !c.heroPlay ||
          !c.dockPlay ||
          !c.deckMeta ||
          !c.deckTimeline
        ) {
          console.error("[verify-player-chrome] INCOMPLETE chrome:", c);
          app.exit(1);
          return;
        }
        console.log("[verify-player-chrome] OK — Hero + full dock + deck meta strip match web /player chrome pattern.");
        app.exit(0);
      } catch (e) {
        console.error("[verify-player-chrome] error:", e);
        app.exit(1);
      }
    }, 8000);
  });
});

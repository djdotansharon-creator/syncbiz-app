/**
 * Writes a PNG of the loaded desktop renderer (post-build). Run: npm run build && node scripts/snapshot-player-ui.cjs
 */
const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");
const { registerMvpIpc } = require(path.join(__dirname, "..", "dist", "main", "ipc-mvp.js"));

const rootDir = path.join(__dirname, "..");
const outPng = path.join(rootDir, "..", "assets", "desktop-debug-panel.png");
app.setPath("userData", path.join(rootDir, ".snapshot-player-ui-userdata"));

let win = null;
function getWindow() {
  return win;
}

app.whenReady().then(() => {
  registerMvpIpc(getWindow);
  win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      preload: path.join(rootDir, "dist", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(rootDir, "dist", "renderer", "index.html"));
  win.webContents.on("did-finish-load", () => {
    setTimeout(async () => {
      try {
        const img = await win.webContents.capturePage();
        fs.mkdirSync(path.dirname(outPng), { recursive: true });
        fs.writeFileSync(outPng, img.toPNG());
        console.log("[snapshot-player-ui] wrote", outPng);
        app.exit(0);
      } catch (e) {
        console.error("[snapshot-player-ui]", e);
        app.exit(1);
      }
    }, 8500);
  });
});

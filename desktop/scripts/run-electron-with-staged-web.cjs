/**
 * Sets SYNCBIZ_DESKTOP_STANDALONE_DIR to desktop/staged-web and launches Electron.
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const electronPath = require("electron");
const desktopRoot = path.resolve(__dirname, "..");
const staged = path.join(desktopRoot, "staged-web");

if (!fs.existsSync(path.join(staged, "server.js"))) {
  console.error(
    "[run-electron-with-staged-web] Missing staged-web/server.js. Run at repo root: npm run build:electron-web",
  );
  process.exit(1);
}

process.env.SYNCBIZ_DESKTOP_STANDALONE_DIR = staged;

const child = spawn(electronPath, ["."], {
  cwd: desktopRoot,
  stdio: "inherit",
  env: process.env,
  shell: false,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

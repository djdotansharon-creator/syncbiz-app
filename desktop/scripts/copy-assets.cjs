const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const repoRoot = path.join(root, "..");
const srcFile = path.join(root, "src", "renderer", "index.html");
const outDir = path.join(root, "dist", "renderer");
const heroCss = path.join(repoRoot, "components", "player-surface", "player-hero-surface.css");
const dockCss = path.join(repoRoot, "components", "player-surface", "playback-dock-surface.css");
const libraryCss = path.join(repoRoot, "components", "player-surface", "library-browse-card-surface.css");
const deckMetaCss = path.join(repoRoot, "components", "player-surface", "player-deck-meta-strip-surface.css");
const deckTransportCss = path.join(repoRoot, "components", "player-surface", "player-deck-transport-strip-surface.css");

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(srcFile, path.join(outDir, "index.html"));
fs.copyFileSync(heroCss, path.join(outDir, "player-hero-surface.css"));
fs.copyFileSync(dockCss, path.join(outDir, "playback-dock-surface.css"));
fs.copyFileSync(libraryCss, path.join(outDir, "library-browse-card-surface.css"));
fs.copyFileSync(deckMetaCss, path.join(outDir, "player-deck-meta-strip-surface.css"));
fs.copyFileSync(deckTransportCss, path.join(outDir, "player-deck-transport-strip-surface.css"));

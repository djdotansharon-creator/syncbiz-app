const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const srcFile = path.join(root, "src", "renderer", "index.html");
const outDir = path.join(root, "dist", "renderer");

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(srcFile, path.join(outDir, "index.html"));

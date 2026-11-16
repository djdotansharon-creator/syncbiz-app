/**
 * C4 (2026-11-14) — shared mpv integrity helpers (pure Node, no network). Used by the build script
 * (fetch-mpv.cjs) and the pin verification test. The runtime fallback (resolver.ts) has its own streaming
 * sha256; this module keeps the BUILD + TEST paths DRY and testable.
 */
"use strict";
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/** sha256 (hex) of a file's bytes. For build-time use (reads the whole file). */
function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/** sha256 (hex) of a buffer/string. */
function sha256Buf(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** Load the owner-vetted pin (desktop/mpv-pin.json). */
function loadPin() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "mpv-pin.json"), "utf-8"));
}

/** Case-insensitive hex equality (both must be non-empty strings). NEVER true for a missing/short value. */
function hexEq(actual, expected) {
  return (
    typeof actual === "string" &&
    typeof expected === "string" &&
    /^[0-9a-f]{64}$/i.test(actual) &&
    /^[0-9a-f]{64}$/i.test(expected) &&
    actual.toLowerCase() === expected.toLowerCase()
  );
}

module.exports = { sha256File, sha256Buf, loadPin, hexEq };

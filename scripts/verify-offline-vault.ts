/**
 * Music Bank Phase 2, stage A (owner 2026-11-10/11): the OFFLINE VAULT — songs stored encrypted on the branch PC, playable
 * only through VONO's loopback server. Proves the crypto, the store, the loopback server and the protections, in plain
 * Node with a temp folder (no Electron, nothing touches MPV / playback — stage A is not wired into playback yet).
 * Run: npx tsx scripts/verify-offline-vault.ts
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { OfflineVault } from "../desktop/src/main/offline/vault-store";
import { startVaultServer } from "../desktop/src/main/offline/vault-server";
import { loadOrCreateMasterKey, type KeyProtector } from "../desktop/src/main/offline/vault-keys";
import { encryptedFileSize, opaqueIdFor } from "../desktop/src/main/offline/vault-crypto";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const root = path.join(__dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf-8").replace(/\r\n/g, "\n");

async function* chunked(buf: Buffer, piece = 64 * 1024 + 7) {
  for (let i = 0; i < buf.length; i += piece) yield buf.subarray(i, i + piece);
}
async function collect(it: AsyncIterable<Buffer>): Promise<Buffer> {
  const out: Buffer[] = [];
  for await (const b of it) out.push(b);
  return Buffer.concat(out);
}
function get(url: string, headers: Record<string, string> = {}, method = "GET"): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      const parts: Buffer[] = [];
      res.on("data", (d: Buffer) => parts.push(d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts) }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "vono-vault-"));
  try {
    // ── keys ──
    const xor = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a));
    const protector: KeyProtector = { available: () => true, protect: xor, unprotect: xor };
    const k1 = loadOrCreateMasterKey(dir, protector);
    const k2 = loadOrCreateMasterKey(dir, protector);
    const keyFile = readFileSync(path.join(dir, "vault.key"), "utf8");
    assert("A1 the master key is created once, reloaded the same, and never stored in plaintext",
      !!k1 && k1.created && !!k2 && !k2.created && k1.key.equals(k2.key) && !keyFile.includes(k1.key.toString("base64")) && !keyFile.includes(k1.key.toString("hex")));
    const wrongUser: KeyProtector = { available: () => true, protect: xor, unprotect: () => { throw new Error("DPAPI: not this user"); } };
    assert("A2 a key that cannot be unprotected (another Windows user / PC) → vault unusable (null), the stored key is not overwritten",
      loadOrCreateMasterKey(dir, wrongUser) === null && readFileSync(path.join(dir, "vault.key"), "utf8") === keyFile
      && loadOrCreateMasterKey(dir, { ...protector, available: () => false }) === null);
    const master = k1!.key;

    // ── store ──
    const chunk = 64 * 1024; // small chunks in the test → many chunks per song
    const vault = new OfflineVault(dir, master, chunk);
    const song = randomBytes(chunk * 5 + 12345); // 5 full chunks + a partial one
    const hash = createHash("sha256").update(song).digest("hex");
    const e = await vault.store(chunked(song), { logicalId: "a_song1", contentHash: hash, sizeBytes: song.length, mimeType: "audio/mpeg" });
    const file = vault.objectPath(e.opaqueId);
    const onDisk = readFileSync(file);
    assert("A3 a stored song is encrypted: right size on disk, opaque file name, no plaintext run of the song inside",
      onDisk.length === encryptedFileSize({ plainSize: song.length, chunkSize: chunk }) && e.opaqueId === opaqueIdFor(master, hash)
      && !path.basename(file).includes("song1") && !onDisk.includes(song.subarray(1000, 1064)) && onDisk.subarray(0, 8).toString() === "VONOENC1");
    assert("A4 the whole song decrypts back exactly", (await collect(vault.readRange(e.opaqueId, 0, song.length - 1))).equals(song));
    let rangesOk = true;
    for (const [s, en] of [[0, 0], [chunk - 1, chunk], [chunk * 2 + 5, chunk * 4 - 3], [song.length - 10, song.length - 1], [123, 123 + chunk * 3]]) {
      const got = await collect(vault.readRange(e.opaqueId, s, en));
      if (!got.equals(song.subarray(s, en + 1))) rangesOk = false;
    }
    assert("A5 any byte range decrypts on its own (seeking): chunk edges, middle, tail", rangesOk);

    let refusedHash = false, refusedSize = false;
    try { await vault.store(chunked(song), { logicalId: "a_bad", contentHash: "0".repeat(64), sizeBytes: song.length }); } catch { refusedHash = true; }
    try { await vault.store(chunked(song.subarray(0, 1000)), { logicalId: "a_short", contentHash: hash, sizeBytes: song.length }); } catch { refusedSize = true; }
    const leftovers = readdirSync(path.join(dir, "objects")).filter((n) => n.endsWith(".part"));
    assert("A6 a download that does not match its hash or size is refused and leaves nothing behind (never 'offline ready')",
      refusedHash && refusedSize && leftovers.length === 0 && vault.lookup("a_bad") === null && vault.lookup("a_short") === null);

    // tamper: flip one byte in chunk 2 → reading that range throws; untouched ranges still read
    const tampered = Buffer.from(onDisk);
    tampered[32 + 2 * (chunk + 16) + 100] ^= 0xff;
    writeFileSync(file, tampered);
    let tamperCaught = false;
    try { await collect(vault.readRange(e.opaqueId, chunk * 2, chunk * 2 + 10)); } catch { tamperCaught = true; }
    const stillOk = (await collect(vault.readRange(e.opaqueId, 0, 10))).equals(song.subarray(0, 11));
    writeFileSync(file, onDisk);
    assert("A7 an altered byte is detected (GCM) — it never plays wrong audio; other chunks still read", tamperCaught && stillOk);

    const other = new OfflineVault(dir, randomBytes(32), chunk);
    let wrongKey = false;
    try { await collect(other.readRange(e.opaqueId, 0, 10)); } catch { wrongKey = true; }
    assert("A8 the file is useless with any other key (copied to another PC)", wrongKey);

    const reopened = new OfflineVault(dir, master, chunk);
    assert("A9 the index survives a restart; lookup is in memory; integrity probe by size",
      reopened.lookup("a_song1")?.opaqueId === e.opaqueId && reopened.isIntact("a_song1") && reopened.diskBytes() === statSync(file).size);

    // ── loopback server ──
    let corrupt: string | null = null;
    const srv = await startVaultServer(vault, { onCorrupt: (id) => { corrupt = id; } });
    const url = srv.urlFor("a_song1")!;
    const full = await get(url);
    const part = await get(url, { Range: `bytes=${chunk}-${chunk * 3 + 9}` });
    const tail = await get(url, { Range: "bytes=-100" });
    assert("A10 the loopback server plays the song: 200 full, 206 for a range (seek), suffix range, right headers",
      url.startsWith("http://127.0.0.1:") && full.status === 200 && full.body.equals(song) && full.headers["accept-ranges"] === "bytes"
      && part.status === 206 && part.body.equals(song.subarray(chunk, chunk * 3 + 10)) && part.headers["content-range"] === `bytes ${chunk}-${chunk * 3 + 9}/${song.length}`
      && tail.status === 206 && tail.body.equals(song.subarray(song.length - 100)));
    const noTok = await get(url.replace(/\?k=.*/, ""));
    const badTok = await get(url.replace(/k=[^&]+/, "k=" + "x".repeat(32)));
    const rebinding = await get(url, { Host: "evil.example:80" });
    const unknown = await get(url.replace(/\/o\/[0-9a-f]{32}/, "/o/" + "0".repeat(32)));
    const post = await get(url, {}, "POST");
    const badRange = await get(url, { Range: `bytes=${song.length + 5}-` });
    assert("A11 refuses: no token / wrong token / foreign Host (DNS rebinding) → 403, unknown song → 404, POST → 405, bad range → 416",
      noTok.status === 403 && badTok.status === 403 && rebinding.status === 403 && unknown.status === 404 && post.status === 405 && badRange.status === 416);
    assert("A12 a song that is not stored has no URL (the caller streams instead)", srv.urlFor("a_not_here") === null);

    writeFileSync(file, tampered);
    let brokenStream = false;
    try { const r = await get(url, { Range: `bytes=${chunk * 2}-${chunk * 2 + 50}` }); brokenStream = r.body.length < 51; } catch { brokenStream = true; }
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(file, onDisk);
    assert("A13 a corrupt file breaks the stream (MPV sees an error, never wrong audio) and is reported", brokenStream && corrupt === e.opaqueId);
    await srv.close();

    vault.remove("a_song1");
    assert("A14 Offline OFF removes the encrypted file and its index entry", vault.lookup("a_song1") === null && !vault.hasObjectFile(e.opaqueId));

    // ── isolation: stage A is not wired into playback ──
    const wired = ["desktop/src/main/mpv-manager.ts", "desktop/src/main/playback-orchestrator.ts", "desktop/src/device-websocket-client/device-ws-manager.ts", "desktop/src/main/ipc-mvp.ts"]
      .filter((f) => { try { return /offline\/vault-/.test(read(f)); } catch { return false; } });
    assert("A15 stage A is inert: no playback file imports the vault yet (MPV / orchestrator / WS / IPC untouched)", wired.length === 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(process.exitCode ?? 0);
}
void main();

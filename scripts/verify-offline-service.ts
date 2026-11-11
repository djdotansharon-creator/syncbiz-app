/**
 * Music Bank Phase 2, stage C (owner-approved 2026-11-11): the OFFLINE SERVICE — resolver on MPV's load path, quiet
 * background download, removal of what is no longer entitled, the encrypted license, and the wiring (one line in
 * MpvManager.loadInternal; init in ipc-mvp; the loopback token redacted from logs). Plain Node, temp folders, fake fetch.
 * Run: npx tsx scripts/verify-offline-service.ts
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { OfflineVault } from "../desktop/src/main/offline/vault-store";
import { startVaultServer } from "../desktop/src/main/offline/vault-server";
import { OfflineService, openLicense, ownMediaLogicalId, sealLicense } from "../desktop/src/main/offline/offline-service";
import { redactMediaToken } from "../desktop/src/shared/redact-media-token";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const root = path.join(__dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf-8").replace(/\r\n/g, "\n");
const API = "https://vono.example";

async function main() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "vono-offsvc-"));
  try {
    const master = randomBytes(32);
    const vault = new OfflineVault(dir, master, 64 * 1024);
    const server = await startVaultServer(vault);
    const songs: Record<string, Buffer> = { a_one: randomBytes(150_000), a_two: randomBytes(90_000) };
    const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    let manifestBanks: Array<{ bankId: string; name: string; endsAt: string | null; validUntil: string; tracks: Array<{ logicalId: string; title: string; contentHash: string; sizeBytes: number; mimeType: string }> }> = [];
    let online = true;
    let mediaCalls = 0;
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      if (!online) throw new Error("ENOTFOUND");
      const u = new URL(String(url));
      if (u.pathname === "/api/music-bank/offline-manifest") {
        const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
        if (auth !== "Bearer station-token") return new Response("{}", { status: 401 });
        return new Response(JSON.stringify({ version: 1, issuedAt: new Date().toISOString(), banks: manifestBanks }), { status: 200 });
      }
      const m = /^\/api\/media\/(.+)$/.exec(u.pathname);
      if (m && u.searchParams.get("mt") === "TOKEN") {
        mediaCalls++;
        const b = songs[decodeURIComponent(m[1])];
        return b ? new Response(new Uint8Array(b), { status: 200 }) : new Response("nf", { status: 404 });
      }
      return new Response("forbidden", { status: 403 });
    }) as unknown as typeof fetch;
    let clock = Date.parse("2026-11-11T12:00:00Z");
    const logs: string[] = [];
    const svc = new OfflineService({
      dir, master, vault, server,
      getConfig: () => ({ apiBaseUrl: API, wsToken: "station-token" }),
      withToken: (u) => (u.startsWith(`${API}/api/media/`) ? `${u}?mt=TOKEN` : u),
      fetchFn: fakeFetch,
      now: () => clock,
      log: (_l, msg) => logs.push(msg),
      rateBytesPerSec: 50 * 1024 * 1024,
      sleep: async () => {},
    });
    const media = (id: string) => `${API}/api/media/${id}`;
    const track = (id: string) => ({ logicalId: id, title: id, contentHash: sha(songs[id]), sizeBytes: songs[id].length, mimeType: "audio/mpeg" });
    const until = new Date(clock + 7 * 86_400_000).toISOString();

    // ── resolver before anything is stored ──
    assert("C1 resolver leaves every URL unchanged when nothing is stored (YouTube, local file, jingle, other host, our media)",
      svc.resolve("https://www.youtube.com/watch?v=x") === "https://www.youtube.com/watch?v=x" && svc.resolve("C:\\Music\\a.mp3") === "C:\\Music\\a.mp3"
      && svc.resolve("https://other.example/api/media/a_one") === "https://other.example/api/media/a_one" && svc.resolve(media("a_one")) === media("a_one")
      && svc.resolve("not a url") === "not a url");
    assert("C2 only our own /api/media/<id> URL is recognised", ownMediaLogicalId(media("a_one"), API) === "a_one" && ownMediaLogicalId(`${API}/api/media/a/b`, API) === null && ownMediaLogicalId(media("a_one"), null) === null);

    // ── sync: download + license ──
    manifestBanks = [{ bankId: "all-day-mix", name: "All Day Mix", endsAt: null, validUntil: until, tracks: [track("a_one"), track("a_two")] }];
    await svc.sync("test");
    const local = svc.resolve(media("a_one"));
    assert("C3 a sync quietly downloads the entitled songs, verifies them and stores them encrypted",
      vault.logicalIds().sort().join() === "a_one,a_two" && mediaCalls === 2 && logs.includes("OFFLINE_SYNC_DONE"));
    let played = Buffer.alloc(0);
    if (local.startsWith("http://127.0.0.1:")) played = Buffer.from(await (await fetch(local)).arrayBuffer());
    assert("C4 a stored + licensed song resolves to the local loopback URL and plays back exactly", local.startsWith("http://127.0.0.1:") && played.equals(songs.a_one));
    const licFile = readFileSync(path.join(dir, "license.bin"));
    assert("C5 the license is stored encrypted (no readable ids / dates) and opens only with this machine's key",
      !licFile.includes(Buffer.from("a_one")) && openLicense(master, licFile)?.until["a_one"] === Date.parse(until) && openLicense(randomBytes(32), licFile) === null);
    await svc.sync("again");
    assert("C6 a second sync downloads nothing new", mediaCalls === 2);

    // ── offline: keep playing on the license ──
    online = false;
    await svc.sync("offline");
    assert("C7 no internet → the license is kept and stored songs still play locally", svc.resolve(media("a_two")).startsWith("http://127.0.0.1:") && vault.logicalIds().length === 2);
    clock = Date.parse(until) + 1000;
    assert("C8 after the license ends the song streams again (the server decides) — no offline playback without a license", svc.resolve(media("a_two")) === media("a_two"));
    clock = Date.parse(until) + 31 * 86_400_000;
    await svc.sync("offline-late");
    assert("C9 stored copies whose license ended over 30 days ago are deleted (owner: lock → delete after 30 days)", vault.logicalIds().length === 0);

    // ── entitlement removed while online; a song in use is kept until it is released ──
    clock = Date.parse("2026-11-12T12:00:00Z");
    online = true;
    const until2 = new Date(clock + 7 * 86_400_000).toISOString();
    manifestBanks = [{ bankId: "all-day-mix", name: "All Day Mix", endsAt: null, validUntil: until2, tracks: [track("a_one"), track("a_two")] }];
    await svc.sync("re-entitled");
    svc.resolve(media("a_one")); // a deck loads a_one now
    manifestBanks = [];
    await svc.sync("bank-closed");
    assert("C10 a bank that is no longer entitled is removed — except the song a deck may be holding (removed on a later sync)",
      vault.lookup("a_two") === null && vault.lookup("a_one") !== null && svc.resolve(media("a_one")) === media("a_one"));
    clock += 20 * 60 * 1000;
    await svc.sync("later");
    assert("C11 …and the held song is removed once it is released", vault.lookup("a_one") === null);

    // ── tampered license / no token ──
    writeFileSync(path.join(dir, "license.bin"), sealLicense(randomBytes(32), { savedAt: 0, until: { a_one: Date.now() + 1e9 } }));
    const svc2 = new OfflineService({ dir, master, vault, server, getConfig: () => ({ apiBaseUrl: API, wsToken: "station-token" }), withToken: (u) => u, fetchFn: fakeFetch, log: () => {} });
    assert("C12 an edited / foreign license gives nothing offline (stream)", svc2.resolve(media("a_one")) === media("a_one"));
    manifestBanks = [{ bankId: "all-day-mix", name: "All Day Mix", endsAt: null, validUntil: until2, tracks: [track("a_one")] }];
    await svc2.sync("no-token");
    assert("C13 without a media token nothing is downloaded (no crash; retried next sync)", vault.lookup("a_one") === null);
    await server.close();

    // ── wiring ──
    const mpv = read("desktop/src/main/mpv-manager.ts");
    assert("C14 MPV: ONE change — the loadfile target passes the offline resolver before the media token (play + prepared standby both use loadInternal)",
      /const \{ target, kind \} = normalizeMpvLoadTarget\(withStationMediaToken\(resolveOfflineUrl\(u\)\)\);/.test(mpv)
      && (mpv.match(/resolveOfflineUrl/g) ?? []).length === 2 && /import \{ resolveOfflineUrl \} from "\.\/offline\/offline-runtime";/.test(mpv));
    const ipc = read("desktop/src/main/ipc-mvp.ts");
    assert("C15 init next to the station media token; refresh on a new desktop token",
      /initOfflineService\(\{ getConfig: \(\) => getEffectiveRuntimeConfig\(\), withToken: withStationMediaToken/.test(ipc) && /refreshOffline\("desktop-auth"\)/.test(ipc));
    const rt = read("desktop/src/main/offline/offline-runtime.ts");
    assert("C16 OFF by default: only a machine whose offline.json says enabled:true runs any of it; failures leave streaming as before",
      /return j\?\.enabled === true;/.test(rt) && /catch \{\s*return false;/.test(rt) && /OFFLINE_DISABLED_ON_THIS_MACHINE/.test(rt) && /return service \? service\.resolve\(url\) : url;/.test(rt));
    const red = redactMediaToken("loadfile http://127.0.0.1:5555/o/abc?k=SECRETSECRET and mt=x");
    assert("C17 the loopback session token never reaches a log line", !red.includes("SECRETSECRET") && red.includes("k=[REDACTED]"));
    const untouched = ["desktop/src/main/playback-orchestrator.ts", "desktop/src/device-websocket-client/device-ws-manager.ts"].every((f) => !/offline\//.test(read(f)));
    assert("C18 the orchestrator and the WS manager are untouched (crossfade, EOF, restore, NEXT/PREV logic unchanged)", untouched);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(process.exitCode ?? 0);
}
void main();

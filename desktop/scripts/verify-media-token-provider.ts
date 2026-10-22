/**
 * beta.22 — station media token (MAIN) tests. Run: npx tsx desktop/scripts/verify-media-token-provider.ts
 *  - only THIS server's /api/media/<id> URLs ever get the token (no other host, no look-alike path, no YouTube/local)
 *  - no token / before init → URL unchanged (today's behaviour); never appended twice
 *  - station identity: Bearer desktop_access → POST <apiBase>/api/music-bank/authorize (no cookie)
 *  - refresh: in-flight de-dupe, < 10 min left → refresh, failure keeps a still-valid token, 15 s back-off
 *  - the token never appears in log payloads; MpvManager.play is the single hook (static check)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { MediaTokenProvider, isOwnMediaUrl, appendMt, withStationMediaToken } from "../src/main/media-token-provider";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const API = "https://syncbiz-app-test-production.up.railway.app";
const MEDIA = `${API}/api/media/a_48dc26d37bdfc9ed`;

async function main(): Promise<void> {
  assert("U1 own media URL recognised", isOwnMediaUrl(MEDIA, API));
  assert("U2 other host / look-alike path / YouTube / local never match",
    !isOwnMediaUrl("https://evil.example/api/media/a_1", API) && !isOwnMediaUrl(`${API}/api/mediax/a_1`, API) &&
    !isOwnMediaUrl(`${API}/api/media/a_1/extra`, API) && !isOwnMediaUrl("https://www.youtube.com/watch?v=x", API) &&
    !isOwnMediaUrl("C:/Music/a.mp3", API) && !isOwnMediaUrl(MEDIA, null));
  assert("U3 mt appended once, query-aware", appendMt(MEDIA, "T") === `${MEDIA}?mt=T` && appendMt(`${MEDIA}?mt=X`, "T") === `${MEDIA}?mt=X` && appendMt(`${MEDIA}?a=1`, "T") === `${MEDIA}?a=1&mt=T`);
  assert("U4 before init the hook is identity", withStationMediaToken(MEDIA) === MEDIA);

  let now = 1_800_000_000_000;
  const calls: { url: string; auth: string | null; cookie: string | null }[] = [];
  const logs: unknown[] = [];
  let respond: () => Response = () => new Response(JSON.stringify({ token: "tok-A", exp: Math.floor(now / 1000) + 1800 }), { status: 200 });
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    calls.push({ url: String(url), auth: h.get("authorization"), cookie: h.get("cookie") });
    return respond();
  }) as unknown as typeof fetch;
  const cfg = { apiBaseUrl: API, wsToken: "desk-tok" };
  const p = new MediaTokenProvider({ getConfig: () => cfg, fetchFn, now: () => now, log: (_l, m, d) => logs.push({ m, d }) });

  assert("T1 no token yet → URL unchanged (load proceeds exactly as today)", p.withToken(MEDIA) === MEDIA);
  await new Promise((r) => setTimeout(r, 10));
  assert("T2 that load triggered ONE station-identity request: Bearer desktop token, no cookie, this server only",
    calls.length === 1 && calls[0].url === `${API}/api/music-bank/authorize` && calls[0].auth === "Bearer desk-tok" && calls[0].cookie === null);
  assert("T3 fresh token → our media URL gets mt", p.withToken(MEDIA) === `${MEDIA}?mt=tok-A` && p.hasFreshToken());
  assert("T4 non-media URLs never get the token", p.withToken("https://www.youtube.com/watch?v=x") === "https://www.youtube.com/watch?v=x" && p.withToken("https://evil.example/api/media/a_1") === "https://evil.example/api/media/a_1");
  assert("T5 no refresh while > 10 min left", (p.withToken(MEDIA), calls.length === 1));

  now += 25 * 60 * 1000; // 5 min left → refresh, old token still used meanwhile
  respond = () => new Response(JSON.stringify({ token: "tok-B", exp: Math.floor(now / 1000) + 1800 }), { status: 200 });
  const during = p.withToken(MEDIA);
  await new Promise((r) => setTimeout(r, 10));
  assert("T6 < 10 min left → background refresh; the still-valid token is used meanwhile", during === `${MEDIA}?mt=tok-A` && calls.length === 2 && p.withToken(MEDIA) === `${MEDIA}?mt=tok-B`);

  const n = calls.length;
  await Promise.all([p.refresh("a"), p.refresh("b"), p.refresh("c")]);
  assert("T7 concurrent refreshes are de-duplicated (one request)", calls.length === n + 1);

  now += 25 * 60 * 1000; // tok-B has 5 min left
  respond = () => new Response(JSON.stringify({ error: "x" }), { status: 401 });
  await p.refresh("tick");
  assert("T8 a failed refresh keeps the still-valid token", p.withToken(MEDIA).endsWith("mt=tok-B"));
  const before = calls.length;
  p.withToken(MEDIA);
  await new Promise((r) => setTimeout(r, 10));
  assert("T9 on-demand refresh backs off 15 s after a failure (no storm)", calls.length === before);

  now += 6 * 60 * 1000; // expired
  assert("T10 expired token is never appended (URL unchanged)", (await new Promise((r) => setTimeout(r, 20)), p.withToken(MEDIA) === MEDIA));

  const cfgNoAuth = { apiBaseUrl: API, wsToken: "" };
  const q = new MediaTokenProvider({ getConfig: () => cfgNoAuth, fetchFn, now: () => now });
  const c0 = calls.length;
  await q.refresh("start");
  assert("T11 no desktop token → no request at all", calls.length === c0);

  const logText = JSON.stringify(logs);
  assert("T12 logs never contain a token (only reason / status / validity)", !/tok-[AB]|desk-tok/.test(logText) && /MEDIA_TOKEN_REFRESHED/.test(logText));

  const mpv = readFileSync(path.join(__dirname, "../src/main/mpv-manager.ts"), "utf8");
  assert("S1 single hook: MpvManager.play normalizes withStationMediaToken(u) and logs only the redacted target",
    /normalizeMpvLoadTarget\(withStationMediaToken\(u\)\)/.test(mpv) && /preview: redactMediaToken\(target\)/.test(mpv) && (mpv.match(/withStationMediaToken\(/g) ?? []).length === 1);
  const ipc = readFileSync(path.join(__dirname, "../src/main/ipc-mvp.ts"), "utf8");
  assert("S2 MAIN wiring: init at startup + refresh on desktop-auth apply", /initStationMediaToken\(\{ getConfig: \(\) => getEffectiveRuntimeConfig\(\)/.test(ipc) && /refreshStationMediaToken\("desktop-auth"\)/.test(ipc));
  const wsm = readFileSync(path.join(__dirname, "../src/device-websocket-client/device-ws-manager.ts"), "utf8");
  assert("S3 the WS layer never touches the media token", !/media-token-provider|withStationMediaToken|mt=/.test(wsm));
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => console.log(`\n${pass} passed, ${fail} failed`));

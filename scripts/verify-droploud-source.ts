/**
 * DROPLOUD URL SOURCE — a pasted Droploud link is resolved ONCE, server-side, at save time, into what it really
 * plays: its SoundCloud track (type "soundcloud") or a Droploud audio file (type "stream-url"). Never YouTube.
 * Proves: URL classification; extraction of THIS track only (not related tracks on the same page); the selection
 * policy (full SoundCloud > full Droploud audio > preview); host allow-lists; resolver outcomes with an injected
 * fetch (no network); and that both server entry points + both client add paths are wired.
 * Run: npx tsx scripts/verify-droploud-source.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DROPLOUD_UNPLAYABLE_CODE,
  classifyDroploudUrl,
  droploudCandidatesFromTrackObject,
  droploudDisplayTitle,
  extractDroploudTrack,
  isDroploudUrl,
  isPlaceholderSourceName,
  normalizeSoundCloudTrackUrl,
  orderDroploudCandidates,
  pickDroploudPlayback,
} from "../lib/droploud";
import { resolveDroploudUrl } from "../lib/droploud-resolve";
import { classifyMusicUrlIngest } from "../lib/playlist-utils";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", ...p), "utf-8").replace(/\r\n/g, "\n");

// ── Fixtures, modelled on real Droploud track pages (Next.js flight chunks, 2026-11-03) ──────────────────────────
const R2 = "https://pub-a3c836eb99ad47b79b3fb24317c2faf6.r2.dev";
const ID_SC = "05f3e677-4d82-41fe-a02d-37128148cceb";
const ID_PREVIEW = "974b8213-c77f-4964-ab0f-2ec1cc9c9b48";
const ID_RELATED = "11111111-2222-4333-8444-555555555555";
const PREVIEW_WAV = `${R2}/preview-tracks/${ID_PREVIEW}/d5f0deac-8507-4c44-804c-5d230664a734.wav`;

function flightPage(payload: string, splitAt?: number): string {
  // Droploud splits flight data across several push() chunks; the object may straddle two of them.
  const parts = splitAt ? [payload.slice(0, splitAt), payload.slice(splitAt)] : [payload];
  const scripts = parts.map((p) => `<script>self.__next_f.push([1,${JSON.stringify(p)}])</script>`).join("");
  return `<!DOCTYPE html><html><head><title>Droploud</title></head><body>${scripts}</body></html>`;
}

const scTrack = {
  id: ID_SC,
  title: "BAILE INoLVIDABLE (BOMBASTIC, JAHMO & FD REMIX)",
  cover_url: `${R2}/covers/${ID_SC}.jpg`,
  soundcloud_url: "https://soundcloud.com/bombastic-official/baile-inolvidable-remix",
  genre: "Latin House",
  collab_artists: [],
};
const relatedTrack = {
  id: ID_RELATED,
  title: "Some Other Track",
  soundcloud_url: "https://soundcloud.com/other/other-track",
  trackId: ID_SC, // a reference to the page's track — must NOT be mistaken for it
};
const scPayload =
  `1:{"related":[${JSON.stringify(relatedTrack)}]}\n` +
  `2:{"track":${JSON.stringify(scTrack)},"artist":{"display_name":"Bad Bunny"}}\n` +
  `3:{"more":[{"id":"${ID_RELATED}x","soundcloud_url":"https://soundcloud.com/x/y"}]}\n`;
const SC_HTML = flightPage(scPayload, Math.floor(scPayload.indexOf(ID_SC + '","title') + 10));

const previewTrack = {
  id: ID_PREVIEW,
  title: "Preview Only Tune",
  cover_url: `${R2}/covers/${ID_PREVIEW}.jpg`,
  soundcloud_url: null,
  track_preview_url: PREVIEW_WAV,
};
const PREVIEW_HTML = flightPage(
  `2:{"track":${JSON.stringify(previewTrack)},"artist":{"display_name":"DJ \\"Quote\\" Name"}}\n` +
    `4:{"related":[${JSON.stringify(relatedTrack)}]}\n`,
);
const NO_AUDIO_HTML = flightPage(`2:{"track":${JSON.stringify({ id: ID_PREVIEW, title: "Silent", soundcloud_url: "" })}}\n`);

// ── 1. Classification ────────────────────────────────────────────────────────────────────────────────────────────
const tp = classifyDroploudUrl(`https://www.droploud.com/track/${ID_SC.toUpperCase()}/?ref=x`);
assert("track page classified (www, uppercase id, trailing slash, query)",
  tp?.kind === "track_page" && tp.trackId === ID_SC && tp.pageUrl === `https://droploud.com/track/${ID_SC}`);
assert("R2 audio file classified", classifyDroploudUrl(PREVIEW_WAV)?.kind === "audio_file");
assert("R2 over http is not accepted as audio", classifyDroploudUrl(PREVIEW_WAV.replace("https:", "http:"))?.kind === "other_page");
assert("droploud homepage → other_page", classifyDroploudUrl("https://droploud.com/")?.kind === "other_page");
assert("droploud profile → other_page", classifyDroploudUrl("https://droploud.com/u/someone")?.kind === "other_page");
assert("non-uuid track path → other_page", classifyDroploudUrl("https://droploud.com/track/abc")?.kind === "other_page");
assert("SoundCloud is not Droploud", !isDroploudUrl("https://soundcloud.com/a/b"));
assert("look-alike host is not Droploud", !isDroploudUrl("https://droploud.com.evil.example/track/" + ID_SC));
const ingest = classifyMusicUrlIngest(`https://droploud.com/track/${ID_SC}`);
assert("ingest: droploud page → provider droploud, direct_playable (never resolve_to_youtube)",
  ingest.provider === "droploud" && ingest.intent === "direct_playable", JSON.stringify(ingest));
assert("ingest: droploud audio file → provider droploud, direct_playable",
  classifyMusicUrlIngest(PREVIEW_WAV).provider === "droploud");
assert("ingest: plain SoundCloud unchanged",
  (() => { const i = classifyMusicUrlIngest("https://soundcloud.com/a/b"); return i.provider === "soundcloud" && i.intent === "direct_playable"; })());

// ── 2. Host / URL allow-lists ────────────────────────────────────────────────────────────────────────────────────
assert("SC track URL normalised", normalizeSoundCloudTrackUrl("https://m.soundcloud.com/User_1/my-track?si=1") === "https://soundcloud.com/User_1/my-track");
assert("SC set rejected", normalizeSoundCloudTrackUrl("https://soundcloud.com/user/sets/x") === null);
assert("SC profile rejected", normalizeSoundCloudTrackUrl("https://soundcloud.com/user") === null);
assert("SC look-alike rejected", normalizeSoundCloudTrackUrl("https://soundcloud.com.evil.example/a/b") === null);
assert("SC http rejected", normalizeSoundCloudTrackUrl("http://soundcloud.com/a/b") === null);
const foreign = droploudCandidatesFromTrackObject({ audio_url: "https://evil.example/a.mp3", track_preview_url: "https://cdn.other/x.wav" });
assert("foreign-host direct audio dropped", foreign.length === 0);

// ── 3. Extraction: THIS track only ───────────────────────────────────────────────────────────────────────────────
const sc = extractDroploudTrack(SC_HTML, ID_SC);
assert("SC page: own track found (object split across flight chunks)", !!sc);
assert("SC page: title", sc?.title === scTrack.title);
assert("SC page: artist", sc?.artist === "Bad Bunny");
assert("SC page: display title 'Artist - Title'", droploudDisplayTitle(sc ?? { candidates: [] } as never) === `Bad Bunny - ${scTrack.title}`);
assert("SC page: cover from Droploud storage", sc?.cover === scTrack.cover_url);
assert("SC page: its OWN soundcloud_url, not a related track's",
  sc?.candidates.length === 1 && sc.candidates[0].url === scTrack.soundcloud_url);
const pv = extractDroploudTrack(PREVIEW_HTML, ID_PREVIEW);
assert("preview page: escaped quotes in artist decoded", pv?.artist === 'DJ "Quote" Name');
assert("preview page: null soundcloud_url ignored, preview kept",
  pv?.candidates.length === 1 && pv.candidates[0].kind === "direct_audio" && pv.candidates[0].fullTrack === false);
assert("unknown track id → null", extractDroploudTrack(SC_HTML, "99999999-9999-4999-8999-999999999999") === null);

// ── 4. Selection policy ──────────────────────────────────────────────────────────────────────────────────────────
const all = droploudCandidatesFromTrackObject({
  track_preview_url: PREVIEW_WAV,
  audio_url: `${R2}/full/a.mp3`,
  soundcloud_url: "https://soundcloud.com/a/b",
});
assert("policy: SoundCloud full first", pickDroploudPlayback(all)?.kind === "soundcloud");
assert("policy order: SC full → direct full → preview",
  orderDroploudCandidates(all).map((c) => c.field).join(",") === "soundcloud_url,audio_url,track_preview_url");
const noSc = droploudCandidatesFromTrackObject({ track_preview_url: PREVIEW_WAV, audio_url: `${R2}/full/a.mp3` });
assert("policy: full Droploud audio beats preview", pickDroploudPlayback(noSc)?.field === "audio_url");
assert("policy: nothing → null", pickDroploudPlayback([]) === null);

// ── 5. Placeholder names ─────────────────────────────────────────────────────────────────────────────────────────
const page = `https://droploud.com/track/${ID_SC}`;
assert("placeholder: Untitled / Hebrew / empty / raw URL / 'droploud'",
  ["Untitled", "ללא כותרת", "", page, "droploud", "droploud.com"].every((n) => isPlaceholderSourceName(n, page)));
assert("real name kept", !isPlaceholderSourceName("My Favourite Mix", page));

// ── 6. Resolver with injected fetch (no network) ─────────────────────────────────────────────────────────────────
type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;
function fakeFetch(routes: Record<string, Route>, log: string[] = []) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    log.push(`${init?.method ?? "GET"} ${url}`);
    const r = routes[url];
    if (!r) throw new Error("unexpected fetch " + url);
    return r(url, init);
  };
}
const html = (body: string, status = 200) => () => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const audio = (ct = "audio/x-wav") => () => new Response(null, { status: 200, headers: { "content-type": ct } });

async function run(): Promise<void> {
  const opts = (routes: Record<string, Route>, log?: string[]) => ({ fetchImpl: fakeFetch(routes, log), noCache: true });

  const r1 = await resolveDroploudUrl(`https://www.droploud.com/track/${ID_SC}`, opts({ [`https://droploud.com/track/${ID_SC}`]: html(SC_HTML) }));
  assert("resolve: SC-backed page → soundcloud",
    r1.kind === "soundcloud" && r1.playUrl === scTrack.soundcloud_url && r1.title === `Bad Bunny - ${scTrack.title}` && r1.cover === scTrack.cover_url,
    JSON.stringify(r1));

  const log2: string[] = [];
  const r2 = await resolveDroploudUrl(`https://droploud.com/track/${ID_PREVIEW}`, opts({
    [`https://droploud.com/track/${ID_PREVIEW}`]: html(PREVIEW_HTML),
    [PREVIEW_WAV]: audio(),
  }, log2));
  assert("resolve: preview-only page → direct_audio (preview), audio verified by HEAD",
    r2.kind === "direct_audio" && r2.playUrl === PREVIEW_WAV && r2.fullTrack === false && log2.includes(`HEAD ${PREVIEW_WAV}`),
    JSON.stringify(r2));

  const r2b = await resolveDroploudUrl(`https://droploud.com/track/${ID_PREVIEW}`, opts({
    [`https://droploud.com/track/${ID_PREVIEW}`]: html(PREVIEW_HTML),
    [PREVIEW_WAV]: () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }),
  }));
  assert("resolve: direct file that is not audio → unsupported", r2b.kind === "unsupported");

  const r2c = await resolveDroploudUrl(`https://droploud.com/track/${ID_PREVIEW}`, opts({
    [`https://droploud.com/track/${ID_PREVIEW}`]: html(PREVIEW_HTML),
    [PREVIEW_WAV]: (_u, init) => init?.method === "HEAD"
      ? new Response(null, { status: 405 })
      : new Response("x", { status: 206, headers: { "content-type": "audio/wav" } }),
  }));
  assert("resolve: HEAD 405 → ranged GET fallback accepts audio", r2c.kind === "direct_audio");

  const r3 = await resolveDroploudUrl(`https://droploud.com/track/${ID_PREVIEW}`, opts({ [`https://droploud.com/track/${ID_PREVIEW}`]: html(NO_AUDIO_HTML) }));
  assert("resolve: page with no audio → unsupported", r3.kind === "unsupported");

  const log4: string[] = [];
  const r4 = await resolveDroploudUrl("https://droploud.com/u/someone", opts({}, log4));
  assert("resolve: non-track Droploud page → unsupported with NO fetch", r4.kind === "unsupported" && log4.length === 0);

  const r5 = await resolveDroploudUrl(PREVIEW_WAV, opts({ [PREVIEW_WAV]: audio() }));
  assert("resolve: pasted Droploud audio file (audio/x-wav) → direct_audio", r5.kind === "direct_audio" && r5.playUrl === PREVIEW_WAV);

  const r6 = await resolveDroploudUrl(PREVIEW_WAV, opts({ [PREVIEW_WAV]: html("<html>") }));
  assert("resolve: audio-host URL serving text/html → unsupported", r6.kind === "unsupported");

  const log7: string[] = [];
  const r7 = await resolveDroploudUrl(`https://droploud.com/track/${ID_SC}`, opts({
    [`https://droploud.com/track/${ID_SC}`]: () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } }),
  }, log7));
  assert("resolve: off-host redirect NOT followed → unsupported", r7.kind === "unsupported" && log7.length === 1);

  const r7b = await resolveDroploudUrl(`https://droploud.com/track/${ID_SC}`, opts({
    [`https://droploud.com/track/${ID_SC}`]: () => new Response(null, { status: 301, headers: { location: `https://www.droploud.com/track/${ID_SC}` } }),
    [`https://www.droploud.com/track/${ID_SC}`]: html(SC_HTML),
  }));
  assert("resolve: on-host redirect followed", r7b.kind === "soundcloud");

  const r8 = await resolveDroploudUrl(`https://droploud.com/track/${ID_SC}`, opts({ [`https://droploud.com/track/${ID_SC}`]: html("err", 500) }));
  assert("resolve: HTTP 500 → unsupported", r8.kind === "unsupported");

  const r9 = await resolveDroploudUrl(`https://droploud.com/track/${ID_SC}`, {
    noCache: true,
    timeoutMs: 50,
    fetchImpl: (_u, init) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted")))),
  });
  assert("resolve: timeout → unsupported (never hangs)", r9.kind === "unsupported");

  const r10 = await resolveDroploudUrl("https://soundcloud.com/a/b", opts({}));
  assert("resolve: non-Droploud URL → unsupported", r10.kind === "unsupported");

  // ── 7. Wiring ──────────────────────────────────────────────────────────────────────────────────────────────────
  const post = read("app", "api", "playlists", "route.ts");
  const postBody = post.slice(post.indexOf("export async function POST"));
  assert("POST /api/playlists resolves Droploud before type validation + catalog",
    /if \(isDroploudUrl\(url\)\)/.test(postBody) &&
      postBody.indexOf("resolveDroploudUrl(url)") < postBody.indexOf("VALID_TYPES.includes(type)") &&
      postBody.indexOf("resolveDroploudUrl(url)") < postBody.indexOf("normalizeCatalogUrlKey(url, type)"));
  assert("POST /api/playlists: unsupported → 422 with DROPLOUD_UNPLAYABLE code (nothing saved)",
    /code: DROPLOUD_UNPLAYABLE_CODE \}, \{ status: 422 \}/.test(postBody) &&
      postBody.indexOf("status: 422") < postBody.indexOf("createPlaylist("));
  assert("POST /api/playlists: soundcloud → type soundcloud, file → stream-url",
    /type = droploud\.kind === "soundcloud" \? "soundcloud" : "stream-url";/.test(postBody));
  const parse = read("app", "api", "sources", "parse-url", "route.ts");
  assert("parse-url resolves Droploud and returns 422 for unplayable",
    /if \(isDroploudUrl\(raw\)\)/.test(parse) && /resolveDroploudUrl\(raw\)/.test(parse) && /code: DROPLOUD_UNPLAYABLE_CODE/.test(parse));
  const shell = read("components", "app-shell.tsx");
  const lib = read("components", "library-input-area.tsx");
  assert("player paste: Droploud never treated as radio", /&&\s*!isDroploudUrl\(trimmed\)/.test(shell));
  assert("library add: Droploud never treated as radio", /&&\s*!isDroploudUrl\(trimmed\)/.test(lib));
  assert("player paste: shows the Droploud error", /DROPLOUD_UNPLAYABLE_CODE \? t\.urlErrorDroploudUnplayable/.test(shell));
  assert("library add: shows the Droploud error", /DROPLOUD_UNPLAYABLE_CODE \? tx\.urlErrorDroploudUnplayable/.test(lib));
  const tr = read("lib", "translations.ts");
  assert("translation in en + he", (tr.match(/urlErrorDroploudUnplayable:/g) ?? []).length === 2);
  assert("error code constant", DROPLOUD_UNPLAYABLE_CODE === "DROPLOUD_UNPLAYABLE");
  assert("server resolver never imported by client components",
    [shell, lib, read("lib", "droploud.ts"), read("lib", "search-playlist-client.ts")].every(
      (src) => !/from "[^"]*droploud-resolve"/.test(src),
    ));
  assert("no YouTube conversion in the Droploud modules",
    ["droploud.ts", "droploud-resolve.ts"].every((f) => {
      const src = read("lib", f);
      return !/from "[^"]*(youtube|yt-dlp)[^"]*"/i.test(src) && !/resolve_to_youtube/.test(src);
    }));

  console.log(`\n${pass} passed, ${fail} failed`);
}

void run();

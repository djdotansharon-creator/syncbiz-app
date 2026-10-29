/**
 * The key-less YouTube search (lib/youtube-page-search.ts) that replaced the removed npm package (owner 2026-10-30: "searching a song takes a year, no result" — after the package was removed yt-dlp was the only
 * key-less search: 30 s and 0 results on a test run). No network: the parser on a fixture page, the clock parser, a failing fetch, and the order of the steps in the route. Run: npx tsx scripts/verify-youtube-page-search.ts
 */
import { readFileSync } from "node:fs";
import { parseClock, parseYouTubeResultsHtml, searchYouTubeByPage } from "../lib/youtube-page-search";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `   -> ${JSON.stringify(detail)}`}`);
  if (ok) pass++;
  else fail++;
}

const vr = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  videoRenderer: { videoId: id, title: { runs: [{ text: title }] }, thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${id}/default.jpg` }, { url: `https://i.ytimg.com/vi/${id}/hq.jpg` }] }, viewCountText: { simpleText: "1,234,567 views" }, lengthText: { simpleText: "3:45" }, ...over },
});
const data = {
  contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [
    vr("AAAAAAAAAAA", "Luis Fonsi - Despacito"),
    { reelShelfRenderer: { items: [vr("SHORTSSHORT", "a short, inside a shelf is still a video entry")] } },
    vr("BBBBBBBBBBB", "", {}),
    vr("AAAAAAAAAAA", "duplicate of the first"),
    vr("CCCCCCCCCCC", "Two parts", { title: { runs: [{ text: "Two " }, { text: "parts" }] }, lengthText: undefined, viewCountText: undefined, thumbnail: undefined }),
    vr("short", "not an 11-character id"),
    vr("DDDDDDDDDDD", "Long one", { lengthText: { simpleText: "1:02:03" } }),
  ] } }] } } } },
};
const html = `<html><head></head><body><script>var ytInitialData = ${JSON.stringify(data)};</script></body></html>`;
const got = parseYouTubeResultsHtml(html, 15);
assert("Y1 the page's videos come out in page order, without duplicates, bad ids or empty titles", got.map((g) => g.videoId).join(",") === "AAAAAAAAAAA,SHORTSSHORT,CCCCCCCCCCC,DDDDDDDDDDD", got.map((g) => g.videoId));
assert("Y2 a title made of several runs is joined; the cover is the largest thumbnail, or YouTube's standard image when there is none", got[2].title === "Two parts" && got[0].cover.endsWith("/hq.jpg") && got[2].cover === "https://img.youtube.com/vi/CCCCCCCCCCC/hqdefault.jpg");
assert("Y3 the watch link, the view count and the duration are read (a missing duration / views stay undefined)", got[0].url === "https://www.youtube.com/watch?v=AAAAAAAAAAA" && got[0].viewCount === 1234567 && got[0].durationSeconds === 225 && got[2].durationSeconds === undefined && got[2].viewCount === undefined);
assert("Y4 clock text: m:ss and h:mm:ss are seconds, anything else is not a duration", parseClock("3:45") === 225 && parseClock("1:02:03") === 3723 && parseClock("LIVE") === undefined && parseClock("") === undefined && parseClock(null) === undefined && parseClock("1:2:3:4") === undefined);
assert("Y5 the limit is respected", parseYouTubeResultsHtml(html, 2).length === 2);
assert("Y6 a page without the data, with broken data or an empty page gives [] (never throws)", parseYouTubeResultsHtml("<html></html>").length === 0 && parseYouTubeResultsHtml("var ytInitialData = {not json;</script>").length === 0 && parseYouTubeResultsHtml("").length === 0);

async function main() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch;
  const a = await searchYouTubeByPage("anything");
  globalThis.fetch = (() => new Promise(() => undefined)) as typeof fetch; // never answers
  const t0 = Date.now();
  const b = await searchYouTubeByPage("anything", 5, 300);
  globalThis.fetch = (() => Promise.resolve(new Response("blocked", { status: 429 }))) as typeof fetch;
  const c = await searchYouTubeByPage("anything");
  globalThis.fetch = realFetch;
  assert("Y7 a network error, a blocked answer (429) and a request that never answers all give [] — the answer for a hung request comes at the timeout (never after the 30 s of yt-dlp)", a.length === 0 && c.length === 0 && b.length === 0 && Date.now() - t0 < 1500);
  assert("Y8 an empty query is not even sent", (await searchYouTubeByPage("   ")).length === 0);

  const route = readFileSync("app/api/sources/search/route.ts", "utf8");
  const iPage = route.indexOf("searchYouTubeByPage(parsed.query");
  const iDlp = route.indexOf("searchYouTubeWithYtDlp(parsed.query");
  assert("Y9 in the route the page search comes BEFORE yt-dlp (yt-dlp is the last resort), and the removed package is not used", iPage > 0 && iDlp > iPage && !/youtube-search-without-api-key["']/.test(route.replace(/\/\/.*$/gm, "")) && !/await import\("youtube-search/.test(route));
  assert("Y10 no new npm dependency was added", !/"youtube-search|"qrcode|"jsonpath|"got"/.test(readFileSync("package.json", "utf8")));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();

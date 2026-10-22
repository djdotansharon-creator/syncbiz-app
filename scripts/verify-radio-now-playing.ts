/**
 * Radio "now playing" (ICY StreamTitle) — parser + SSRF guard. No network: streams are built in memory and the
 * private-address cases are literal IPs / reserved names.
 * Run: npx tsx scripts/verify-radio-now-playing.ts
 */
import { isPublicHttpUrl, readFirstIcyTitle } from "../lib/radio-icy";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) pass++;
  else fail++;
}

/** An ICY stream: `metaint` bytes of audio, then the metadata block, delivered in small chunks. */
function icyResponse(meta: Uint8Array | null, metaint = 1000, chunk = 333, headers: Record<string, string> = {}): Response {
  const block = meta ? padTo16(meta) : new Uint8Array(0);
  const body = new Uint8Array(metaint + 1 + block.length + 500);
  body[metaint] = block.length / 16;
  body.set(block, metaint + 1);
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (let i = 0; i < body.length; i += chunk) ctrl.enqueue(body.subarray(i, i + chunk));
      ctrl.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "icy-metaint": String(metaint), ...headers } });
}
function padTo16(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(b.length / 16) * 16);
  out.set(b);
  return out;
}
const utf8 = (s: string) => new TextEncoder().encode(s);

async function main() {
  assert("R1 utf-8 title", (await readFirstIcyTitle(icyResponse(utf8("StreamTitle='Queen - Bohemian Rhapsody';StreamUrl='';")))) === "Queen - Bohemian Rhapsody");
  assert("R2 Hebrew utf-8 title", (await readFirstIcyTitle(icyResponse(utf8("StreamTitle='עומר אדם - תגידו לה';")))) === "עומר אדם - תגידו לה");
  // "שלום" in windows-1255 = F9 EC E5 ED
  const w1255 = new Uint8Array([...utf8("StreamTitle='"), 0xf9, 0xec, 0xe5, 0xed, ...utf8("';")]);
  assert("R3 Hebrew windows-1255 title", (await readFirstIcyTitle(icyResponse(w1255))) === "שלום");
  assert("R4 empty title → null", (await readFirstIcyTitle(icyResponse(utf8("StreamTitle='';")))) === null);
  assert("R5 metadata block of length 0 → null", (await readFirstIcyTitle(icyResponse(null))) === null);
  assert("R6 no icy-metaint header → null", (await readFirstIcyTitle(new Response("audio"))) === null);
  assert("R7 one-byte chunks still parse", (await readFirstIcyTitle(icyResponse(utf8("StreamTitle='A - B';"), 50, 1))) === "A - B");
  assert("R8 huge icy-metaint refused", (await readFirstIcyTitle(icyResponse(utf8("StreamTitle='x';"), 10, 333, { "icy-metaint": "99999999" }))) === null);
  assert("R9 HTTP error → null", (await readFirstIcyTitle(new Response("no", { status: 404, headers: { "icy-metaint": "16" } }))) === null);

  for (const url of [
    "http://localhost/x",
    "http://127.0.0.1:3000/",
    "http://10.1.2.3/",
    "http://172.20.0.5/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://100.64.0.1/",
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:10.0.0.1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://postgres.railway.internal:5432/",
    "http://printer.local/",
    "ftp://example.com/",
    "file:///etc/passwd",
    "not a url",
  ]) {
    assert(`S blocks ${url}`, (await isPublicHttpUrl(url)) === false);
  }
  assert("S allows a public IP literal", (await isPublicHttpUrl("http://8.8.8.8/stream")) === true);
  assert("S allows a public IPv4-mapped literal", (await isPublicHttpUrl("http://[::ffff:8.8.8.8]/stream")) === true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();

/**
 * OFFLINE VAULT — loopback decrypt server (Music Bank Phase 2, stage A; owner 2026-11-10/11). PURE Node (no Electron).
 *
 * MPV plays an offline song from `http://127.0.0.1:<random port>/o/<opaque id>?k=<session token>`; this server decrypts
 * the requested byte range on the fly (Range → 206, so seeking works) — the plaintext never touches the disk.
 *  - Listens on 127.0.0.1 only, on a random port chosen by the OS.
 *  - Every request must carry this run's random session token (constant-time compare) AND a loopback Host header
 *    (blocks DNS-rebinding from a web page). Wrong / missing → 403. Unknown song → 404. Only GET / HEAD.
 *  - A GCM failure mid-song destroys the connection (MPV sees an error, never wrong audio) and reports the song as
 *    corrupt through `onCorrupt` (the caller drops it from "offline ready" so the next load streams).
 *  - Nothing here is ever logged with the token (the caller must redact `k=` from MPV log lines — stage C).
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { OfflineVault } from "./vault-store";

export type VaultServer = {
  port: number;
  /** URL MPV loads for a stored song, or null when it is not stored. */
  urlFor: (logicalId: string) => string | null;
  close: () => Promise<void>;
};

function parseRange(header: string | undefined, size: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return "invalid";
  return { start, end };
}

export function startVaultServer(vault: OfflineVault, opts: { onCorrupt?: (opaqueId: string) => void } = {}): Promise<VaultServer> {
  const token = randomBytes(24).toString("base64url");
  const tokenBuf = Buffer.from(token);
  let port = 0;

  const tokenOk = (given: string | null): boolean => {
    if (!given) return false;
    const g = Buffer.from(given);
    return g.length === tokenBuf.length && timingSafeEqual(g, tokenBuf);
  };

  const server = http.createServer((req, res) => {
    const deny = (code: number) => {
      res.writeHead(code, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      res.end();
    };
    if (req.method !== "GET" && req.method !== "HEAD") return deny(405);
    const host = (req.headers.host ?? "").toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return deny(403);
    let u: URL;
    try {
      u = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    } catch {
      return deny(400);
    }
    if (!tokenOk(u.searchParams.get("k"))) return deny(403);
    const m = /^\/o\/([0-9a-f]{32})$/.exec(u.pathname);
    if (!m) return deny(404);
    const entry = vault.byOpaqueId(m[1]);
    if (!entry) return deny(404);

    const size = entry.sizeBytes;
    const range = parseRange(typeof req.headers.range === "string" ? req.headers.range : undefined, size);
    if (range === "invalid") {
      res.writeHead(416, { "Content-Range": `bytes */${size}`, "Cache-Control": "no-store" });
      return res.end();
    }
    const start = range ? range.start : 0;
    const end = range ? range.end : size - 1;
    const headers: Record<string, string | number> = {
      "Content-Type": entry.mimeType,
      "Accept-Ranges": "bytes",
      "Content-Length": size === 0 ? 0 : end - start + 1,
      "Cache-Control": "no-store",
    };
    if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === "HEAD" || size === 0) return res.end();

    void (async () => {
      try {
        for await (const piece of vault.readRange(entry.opaqueId, start, end)) {
          if (res.destroyed) return;
          if (!res.write(piece)) await new Promise<void>((r) => res.once("drain", () => r()));
        }
        res.end();
      } catch {
        opts.onCorrupt?.(entry.opaqueId);
        res.destroy(); // MPV sees a broken stream — never wrong audio
      }
    })();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as AddressInfo).port;
      resolve({
        port,
        urlFor: (logicalId) => {
          const e = vault.lookup(logicalId);
          return e ? `http://127.0.0.1:${port}/o/${e.opaqueId}?k=${token}` : null;
        },
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

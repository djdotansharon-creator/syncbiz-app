/**
 * Thin HTTP layer for the runtime-binaries module.
 *
 * Everything funnels through Electron's `net` module (not Node `https`)
 * because it transparently honours system proxy/auth settings. One user on a
 * corporate proxy is enough reason to keep this choice.
 */

import { net } from "electron";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";

const USER_AGENT = "syncbiz-desktop/runtime-binaries";

export type HttpProgress = {
  bytesReceived: number;
  /** -1 when the upstream doesn't send Content-Length (chunked transfer). */
  bytesTotal: number;
  /** 0..100. 0 when bytesTotal is unknown. */
  percent: number;
};

export type GithubAsset = {
  name: string;
  browser_download_url: string;
  size: number;
};

export type GithubRelease = {
  tag_name: string;
  name: string;
  assets: GithubAsset[];
};

/**
 * Fetch a URL into memory (used for small payloads: GitHub release JSON,
 * SHA256 sidecar files — never for the binaries themselves).
 */
export async function fetchToBuffer(url: string, accept?: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const req = net.request({ url, redirect: "follow", method: "GET" });
    req.setHeader("User-Agent", USER_AGENT);
    if (accept) req.setHeader("Accept", accept);

    const chunks: Buffer[] = [];
    req.on("response", (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.on("data", () => undefined);
        res.on("end", () => undefined);
        return reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage ?? ""} for ${url}`));
      }
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

export async function fetchJson<T>(url: string): Promise<T> {
  const buf = await fetchToBuffer(url, "application/json");
  return JSON.parse(buf.toString("utf-8")) as T;
}

export async function fetchText(url: string): Promise<string> {
  const buf = await fetchToBuffer(url, "text/plain");
  return buf.toString("utf-8");
}

/**
 * Fetch the `/releases/latest` metadata from GitHub. The `Accept` header is
 * `application/vnd.github+json` per GitHub's recommendation.
 */
export async function fetchLatestRelease(owner: string, repo: string): Promise<GithubRelease> {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  const buf = await fetchToBuffer(url, "application/vnd.github+json");
  return JSON.parse(buf.toString("utf-8")) as GithubRelease;
}

/**
 * Stream a URL to disk with progress events. Writes to `<dest>.partial` first
 * and atomic-renames on success so that a killed download never leaves
 * behind a half-written binary that the resolver would then trust.
 */
export async function downloadToFile(
  url: string,
  destPath: string,
  onProgress?: (p: HttpProgress) => void,
): Promise<void> {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const tmpPath = `${destPath}.partial`;
  // Wipe any leftover partial from a previous aborted run — starting fresh
  // is simpler than implementing resumable downloads, and release binaries
  // are small enough (<50MB) that redoing them is cheap.
  await fs.rm(tmpPath, { force: true });

  await new Promise<void>((resolve, reject) => {
    const req = net.request({ url, redirect: "follow", method: "GET" });
    req.setHeader("User-Agent", USER_AGENT);

    let file: ReturnType<typeof createWriteStream> | null = null;
    let bytesReceived = 0;
    let bytesTotal = -1;
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    req.on("response", (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.on("data", () => undefined);
        res.on("end", () => undefined);
        return settle(() => reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage ?? ""} for ${url}`)));
      }

      const len = res.headers["content-length"];
      if (typeof len === "string") {
        const n = parseInt(len, 10);
        if (Number.isFinite(n) && n >= 0) bytesTotal = n;
      } else if (Array.isArray(len) && len[0]) {
        const n = parseInt(len[0], 10);
        if (Number.isFinite(n) && n >= 0) bytesTotal = n;
      }

      file = createWriteStream(tmpPath);
      file.on("error", (err) => settle(() => reject(err)));

      res.on("data", (chunk: Buffer) => {
        file?.write(chunk);
        bytesReceived += chunk.length;
        if (onProgress) {
          onProgress({
            bytesReceived,
            bytesTotal,
            percent: bytesTotal > 0 ? (bytesReceived / bytesTotal) * 100 : 0,
          });
        }
      });
      res.on("end", () => {
        file?.end();
      });
      res.on("error", (err) => settle(() => reject(err)));

      file.on("finish", () => {
        fs.rename(tmpPath, destPath)
          .then(() => settle(() => resolve()))
          .catch((err) => settle(() => reject(err)));
      });
    });

    req.on("error", (err) => settle(() => reject(err)));
    req.end();
  });
}

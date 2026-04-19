import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

/** Parse a .env / .env.local file into a key→value map. Skips comments and blank lines. */
function parseEnvFile(filePath: string): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    for (const raw of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      // Strip optional surrounding quotes from value
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key) out[key] = val;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Load .env then .env.local from the project root, returning vars not already in process.env.
 * standaloneRoot is desktop/staged-web; project root is two levels up.
 * Falls back to process.cwd() if the derived root has no env files.
 */
function loadDotEnvVars(standaloneRoot: string): Record<string, string> {
  const candidates = [
    path.resolve(standaloneRoot, "../.."), // desktop/staged-web → desktop → project root
    process.cwd(),
  ];
  let merged: Record<string, string> = {};
  for (const dir of candidates) {
    const hasAny = existsSync(path.join(dir, ".env")) || existsSync(path.join(dir, ".env.local"));
    if (hasAny) {
      merged = {
        ...parseEnvFile(path.join(dir, ".env")),
        ...parseEnvFile(path.join(dir, ".env.local")),
      };
      break;
    }
  }
  // Don't override vars already present in process.env
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) {
    if (process.env[k] === undefined) result[k] = v;
  }
  return result;
}

export type EmbeddedNextHandle = {
  baseUrl: string;
  child: ChildProcess;
};

function nodeBinary(): string {
  return process.env.SYNCBIZ_DESKTOP_NODE?.trim() || "node";
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      const port = typeof a === "object" && a ? a.port : 0;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

async function waitForHttpOk(baseUrl: string, maxMs: number): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(baseUrl, { redirect: "manual" });
      if (r.status < 500) return;
    } catch {
      /* ECONNREFUSED until server listens */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`[SyncBiz desktop] embedded Next did not become ready: ${baseUrl}`);
}

/**
 * Spawns `node server.js` from a Next `output: "standalone"` tree (after static/public staging).
 * Binds loopback only via PORT; load the app at the returned baseUrl.
 */
export async function startEmbeddedNextServer(standaloneRoot: string): Promise<EmbeddedNextHandle> {
  const root = path.resolve(standaloneRoot);
  const serverJs = path.join(root, "server.js");
  if (!existsSync(serverJs)) {
    throw new Error(`[SyncBiz desktop] missing server.js under ${root}`);
  }

  const port = await getFreePort();
  if (!port) throw new Error("[SyncBiz desktop] could not allocate a free port");

  const child = spawn(nodeBinary(), [serverJs], {
    cwd: root,
    env: {
      ...loadDotEnvVars(root),  // .env + .env.local from project root (process.env wins)
      ...process.env,
      PORT: String(port),
      HOSTNAME: "localhost",
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const baseUrl = `http://localhost:${port}`;

  if (process.env.SYNCBIZ_DESKTOP_EMBEDDED_LOG === "1") {
    child.stderr?.on("data", (d: Buffer) => {
      process.stderr.write(d);
    });
    child.stdout?.on("data", (d: Buffer) => {
      process.stdout.write(d);
    });
  }

  child.on("error", (err) => {
    console.error("[SyncBiz desktop] embedded Next spawn error:", err);
  });

  await waitForHttpOk(baseUrl, 90_000);

  return { baseUrl, child };
}

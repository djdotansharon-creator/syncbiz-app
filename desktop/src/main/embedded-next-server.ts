import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { app } from "electron";
import { fileLog } from "./file-logger";

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
 * Load .env then .env.local, returning vars not already in process.env.
 *
 * Search order (first directory that contains any env file wins):
 *   1. standaloneRoot itself      — packaged: resources/syncbiz-web (.env is
 *                                   part of the Next.js standalone output)
 *   2. standaloneRoot/../..       — dev: desktop/staged-web → project root
 *   3. process.cwd()              — last-resort fallback
 */
function loadDotEnvVars(standaloneRoot: string): Record<string, string> {
  const candidates = [
    standaloneRoot,                        // packaged: resources/syncbiz-web
    path.resolve(standaloneRoot, "../.."), // dev: desktop/staged-web → project root
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

/**
 * Resolve the Node.js runtime to use for spawning the embedded Next server.
 *
 * Priority:
 *   1. SYNCBIZ_DESKTOP_NODE env override (testing / CI).
 *   2. Packaged build → process.execPath with ELECTRON_RUN_AS_NODE=1.
 *      End-users never have Node installed; Electron ships its own Node
 *      runtime that can run plain Node scripts in this mode.
 *   3. Dev (unpackaged) → system "node" (keeps dev workflow simple).
 */
function nodeBinary(): { bin: string; asElectronNode: boolean } {
  const override = process.env.SYNCBIZ_DESKTOP_NODE?.trim();
  if (override) return { bin: override, asElectronNode: false };
  if (app.isPackaged) return { bin: process.execPath, asElectronNode: true };
  return { bin: "node", asElectronNode: false };
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

  fileLog("INFO", "startEmbeddedNextServer: checking standalone root", {
    root,
    serverJsExists: existsSync(serverJs),
  });

  if (!existsSync(serverJs)) {
    fileLog("ERROR", "startEmbeddedNextServer: missing server.js", { root });
    throw new Error(`[SyncBiz desktop] missing server.js under ${root}`);
  }

  const port = await getFreePort();
  if (!port) {
    fileLog("ERROR", "startEmbeddedNextServer: could not allocate free port");
    throw new Error("[SyncBiz desktop] could not allocate a free port");
  }
  fileLog("INFO", "startEmbeddedNextServer: allocated port", { port });

  const { bin: nodeBin, asElectronNode } = nodeBinary();
  const envVars = loadDotEnvVars(root);

  fileLog("INFO", "startEmbeddedNextServer: spawning embedded Next server", {
    nodeBin,
    asElectronNode,
    serverJs,
    port,
    dotEnvKeysLoaded: Object.keys(envVars),
    isPackaged: app.isPackaged,
    execPath: process.execPath,
  });

  const child = spawn(nodeBin, [serverJs], {
    cwd: root,
    env: {
      ...envVars,
      ...process.env,
      PORT: String(port),
      HOSTNAME: "localhost",
      NODE_ENV: "production",
      // When using Electron's own executable as the Node runtime, this flag
      // tells Electron to run the given script as a plain Node.js process
      // rather than starting the full Electron browser stack.
      ...(asElectronNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const baseUrl = `http://localhost:${port}`;

  // Always pipe stdout/stderr to file logger so we can diagnose Next.js startup errors
  child.stdout?.on("data", (d: Buffer) => {
    const lines = d.toString().trim();
    if (lines) fileLog("INFO", "[embedded-next stdout]", { lines });
  });
  child.stderr?.on("data", (d: Buffer) => {
    const lines = d.toString().trim();
    if (lines) fileLog("WARN", "[embedded-next stderr]", { lines });
  });

  // If the child dies before the server is reachable, fail fast instead of blocking
  // on waitForHttpOk for the full 90s (which produced a blank-window hang on startup).
  let startupSettled = false;
  const childDied = new Promise<never>((_resolve, reject) => {
    const failStartup = (message: string) => {
      if (startupSettled) return;
      reject(new Error(message));
    };
    child.on("error", (err) => {
      fileLog("ERROR", "startEmbeddedNextServer: child spawn error", { message: err.message, code: (err as NodeJS.ErrnoException).code });
      console.error("[SyncBiz desktop] embedded Next spawn error:", err);
      failStartup(`embedded Next spawn error: ${err.message}`);
    });
    child.on("exit", (code, signal) => {
      fileLog(code === 0 ? "INFO" : "ERROR", "startEmbeddedNextServer: child exited", { code, signal });
      failStartup(`embedded Next server exited before ready (code=${code ?? "null"}, signal=${signal ?? "null"})`);
    });
  });
  // Once the server is ready this rejection loses the race; swallow it so a later
  // normal exit does not surface as an unhandled rejection.
  childDied.catch(() => {});

  fileLog("INFO", "startEmbeddedNextServer: waiting for HTTP OK", { baseUrl, maxMs: 90_000 });
  try {
    await Promise.race([waitForHttpOk(baseUrl, 90_000), childDied]);
    startupSettled = true;
  } catch (err) {
    startupSettled = true;
    fileLog("ERROR", "startEmbeddedNextServer: startup failed", { baseUrl, message: (err as Error)?.message });
    throw err;
  }

  fileLog("INFO", "startEmbeddedNextServer: server ready", { baseUrl });
  return { baseUrl, child };
}

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

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

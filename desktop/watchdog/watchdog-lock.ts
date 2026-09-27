/**
 * VONO Watchdog — single-instance LOCK (atomic, owner-token, path-verified).
 *
 * Exactly one watchdog per machine, alongside the Scheduled Task's MultipleInstances=IgnoreNew.
 * Acquisition is ATOMIC: exclusive create (`open(..., "wx")`) that fails if the file exists — never a
 * non-atomic "check exists → create". If acquisition fails, the caller exits cleanly.
 *
 * IDENTITY is never "pid alive + image basename = node.exe" (PID reuse + any node.exe would match).
 * Instead the lock stores a per-instance random ownerId plus the FULL nodePath/entryPath, and an
 * existing lock counts as a LIVE watchdog only when its pid is alive AND that pid's real executable
 * path equals OUR bundled node.exe path (and, when readable, its command line references watchdog.cjs).
 * Otherwise the lock is stale/foreign and the FILE is reclaimed — no process is ever killed.
 *
 * RELEASE deletes the lock ONLY if the on-disk ownerId still matches this process, so an old instance
 * can never delete a lock now owned by a newer watchdog.
 *
 * All OS interaction is injected via LockDeps → unit-testable without real files/processes.
 */

export interface LockRecord {
  ownerId: string;
  pid: number;
  createdAt: number;
  nodePath: string;
  entryPath: string;
}

export interface LockDeps {
  lockPath: string;
  ownerId: string; // unique per watchdog instance (e.g. crypto.randomUUID())
  pid: number;
  nodePath: string; // our bundled runtime, e.g. <install>\vono-watchdog\node.exe
  entryPath: string; // our watchdog entry, e.g. <install>\vono-watchdog\watchdog.cjs
  now: () => number;
  log: (line: string) => void;
  /** Atomic exclusive create. Returns a file descriptor, or null if the file already exists (EEXIST). */
  openExclusive: (p: string) => number | null;
  writeLock: (fd: number, data: string) => void;
  closeFd: (fd: number) => void;
  readLock: (p: string) => LockRecord | null;
  unlink: (p: string) => void;
  isProcessAlive: (pid: number) => boolean;
  /** Full executable path of pid (e.g. "...\\vono-watchdog\\node.exe"), or null if unknown. */
  processExecPath: (pid: number) => string | null;
  /** Command line of pid, or null if unknown/unreadable. */
  processCommandLine: (pid: number) => string | null;
}

export interface LockHandle {
  release: () => void;
}

/** Case-insensitive path equality after separator normalization (Windows). */
function samePath(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const norm = (s: string) => s.replace(/\//g, "\\").replace(/\\+/g, "\\").trim().toLowerCase();
  return norm(a) === norm(b);
}

/** Is the pid holding the lock a LIVE instance of OUR watchdog (not a reused/foreign process)? */
function isLiveOwnWatchdog(deps: LockDeps, rec: LockRecord | null, pid: number): boolean {
  const exe = deps.processExecPath(pid);
  if (exe === null) {
    // Identity unverifiable ⇒ be conservative: assume a live watchdog and do NOT reclaim/steal.
    deps.log(`[LOCK] pid ${pid} exec path unverifiable — assuming live watchdog (no steal)`);
    return true;
  }
  // Must be running OUR bundled node.exe path (basename alone is insufficient).
  if (!samePath(exe, deps.nodePath)) return false;
  // If we can read the command line, it must reference our watchdog entry.
  const cmd = deps.processCommandLine(pid);
  if (cmd !== null && !cmd.toLowerCase().includes("watchdog.cjs")) return false;
  // Extra corroboration when the record carries the path.
  if (rec?.nodePath && !samePath(rec.nodePath, deps.nodePath)) return false;
  return true;
}

/** Acquire the single-watchdog lock, or return null if another live watchdog already holds it. */
export function acquireLock(deps: LockDeps): LockHandle | null {
  for (let attempt = 0; attempt < 2; attempt++) {
    const fd = deps.openExclusive(deps.lockPath); // ATOMIC wx — no check-then-create race
    if (fd !== null) {
      const rec: LockRecord = {
        ownerId: deps.ownerId, pid: deps.pid, createdAt: deps.now(),
        nodePath: deps.nodePath, entryPath: deps.entryPath,
      };
      try { deps.writeLock(fd, JSON.stringify(rec)); } catch { /* best effort */ }
      try { deps.closeFd(fd); } catch { /* best effort */ }
      return {
        release: () => {
          // Delete ONLY if we still own it — never remove a newer watchdog's lock.
          try {
            const cur = deps.readLock(deps.lockPath);
            if (cur && cur.ownerId === deps.ownerId) deps.unlink(deps.lockPath);
            else deps.log(`[LOCK] release skipped — lock now owned by ${cur?.ownerId ?? "?"}, not us`);
          } catch { /* ignore */ }
        },
      };
    }

    // Lock exists → decide whether it is STALE. We never kill; we only reclaim the FILE when safe.
    const cur = deps.readLock(deps.lockPath);
    const otherPid = typeof cur?.pid === "number" ? cur.pid : null;

    if (!otherPid || !deps.isProcessAlive(otherPid)) {
      deps.log(`[LOCK] stale lock (pid ${otherPid ?? "?"} not alive) — reclaiming`);
      deps.unlink(deps.lockPath);
      continue;
    }

    if (isLiveOwnWatchdog(deps, cur, otherPid)) {
      deps.log(`[LOCK] another watchdog (pid ${otherPid}, owner ${cur?.ownerId ?? "?"}) holds the lock — exiting cleanly`);
      return null;
    }

    // Alive but NOT our watchdog (pid reused by an unrelated process, incl. a different node.exe path).
    // Reclaim the FILE; the foreign process is NEVER killed.
    deps.log(`[LOCK] lock pid ${otherPid} is a foreign/reused process (exec path ≠ bundled node) — reclaiming file, NOT killing`);
    deps.unlink(deps.lockPath);
    continue;
  }

  deps.log(`[LOCK] could not acquire lock after reclaim attempt — exiting cleanly`);
  return null;
}

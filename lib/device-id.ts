/**
 * Browser device identity for remote player control — ONE live tab = ONE deviceId (owner 2026-10-23).
 *
 * Before: one id per browser profile (localStorage), shared by every tab and window. The WS server keeps one socket
 * per deviceId, so a second tab silently took over the first one's socket: commands (jingles, remote) reached the
 * wrong tab and two tabs both showed MASTER.
 *
 * Now the id is CLAIMED asynchronously, held with a Web Lock for as long as the tab lives:
 *   1. this tab's own id (sessionStorage) — a refresh waits for the previous document to release it. Only the SAME
 *      tab may wait: Duplicate tab and window.open copy sessionStorage but NOT window.name (verified in Chromium),
 *      so the tab marks itself in window.name; a copy takes the id only if it is free and not mid-reload;
 *   2. the profile's stable id (localStorage "device_id", unchanged key) — so a single tab, a kiosk, the streamer
 *      and the Electron window keep exactly today's identity — unless its owner tab is mid-reload;
 *   3. otherwise a fresh id (new tab, duplicated tab, window.open while the original lives).
 * "Mid-reload" = a short handoff marker per id, written on pagehide by the tab that holds it.
 * No Web Locks → FAIL-SAFE: a fresh id for this page (never persisted), never a shared one.
 *
 * There is deliberately NO synchronous getter that could hand out an unclaimed id: callers await claimDeviceId()
 * (WS REGISTER waits for it); getClaimedDeviceId() is null until the claim resolved.
 *
 * The Electron renderer id stays SEPARATE from the MAIN durable machine id (C:\ProgramData\VONO\state\device-id.json):
 * both register as role "device", so sharing one id would collide in the server's devices Map.
 */

const STABLE_KEY = "device_id";
const TAB_KEY = "vono_tab_device_id";
const HANDOFF_PREFIX = "vono_device_handoff:";
/** window.name marker of the tab that owns an id — survives reload / same-tab navigation, never copied to a new tab. */
const TAB_NAME_PREFIX = "vono-tab:";
const LOCK_PREFIX = "vono-device:";
/** How long a tab waits for its OWN id while the previous document of the same tab (a reload) releases the lock. */
const RELOAD_WAIT_MS = 3000;
/** A handoff marker newer than this means the id's owner tab is reloading — another tab must not take it. */
const HANDOFF_TTL_MS = 10_000;

let claimed: string | null = null;
let claimPromise: Promise<string> | null = null;

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function read(store: Storage | undefined, key: string): string | null {
  try {
    const v = store?.getItem(key);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function write(store: Storage | undefined, key: string, value: string | null): void {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, value);
  } catch {
    /* storage unavailable — the in-memory claim still holds */
  }
}

function handoffPending(id: string): boolean {
  const at = Number(read(globalThis.localStorage, HANDOFF_PREFIX + id));
  return Number.isFinite(at) && at > 0 && Date.now() - at < HANDOFF_TTL_MS;
}

/** Drop stale handoff markers (one per closed tab) so localStorage does not grow. */
function pruneHandoffs(): void {
  try {
    const ls = globalThis.localStorage;
    for (let i = ls.length - 1; i >= 0; i--) {
      const k = ls.key(i);
      if (k?.startsWith(HANDOFF_PREFIX) && !handoffPending(k.slice(HANDOFF_PREFIX.length))) ls.removeItem(k);
    }
  } catch {
    /* storage unavailable */
  }
}

/**
 * Take and keep (until the page dies, or release() is called) the Web Lock for `id`. waitMs 0 = only if free right
 * now. Resolves the release function, or null when the lock was not obtained.
 */
function hold(id: string, waitMs: number): Promise<(() => void) | null> {
  return new Promise((resolve) => {
    let settled = false;
    let release: () => void = () => {};
    const finish = (ok: boolean) => {
      if (!settled) {
        settled = true;
        resolve(ok ? release : null);
      }
    };
    const keepForever = () => new Promise<void>((done) => (release = done));
    try {
      if (waitMs <= 0) {
        void navigator.locks
          .request(LOCK_PREFIX + id, { ifAvailable: true }, (lock) => {
            if (!lock) return finish(false);
            const kept = keepForever();
            finish(true);
            return kept;
          })
          .catch(() => finish(false));
        return;
      }
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), waitMs);
      void navigator.locks
        .request(LOCK_PREFIX + id, { signal: ctl.signal }, () => {
          clearTimeout(timer);
          const kept = keepForever();
          finish(true);
          return kept;
        })
        .catch(() => {
          clearTimeout(timer);
          finish(false);
        });
    } catch {
      finish(false);
    }
  });
}

/**
 * Take `id` only if it is free right now AND its owner tab is not mid-reload. The marker is checked again AFTER the
 * lock is ours: the owner may have started reloading (pagehide marker → lock released) between the first check and
 * the lock grant — then step aside so the returning tab gets its id back.
 */
async function holdIfFreeAndIdle(id: string): Promise<boolean> {
  if (handoffPending(id)) return false;
  const release = await hold(id, 0);
  if (!release) return false;
  if (handoffPending(id)) {
    release();
    return false;
  }
  return true;
}

async function runClaim(): Promise<string> {
  if (typeof window === "undefined") return "";
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== "function") {
    // FAIL-SAFE: without Web Locks we cannot prove an id is not used by another live tab → unique per page.
    const id = uuid();
    console.warn("[SyncBiz] device_id: Web Locks unavailable — temporary per-page id", id);
    return id;
  }
  let stable = read(globalThis.localStorage, STABLE_KEY);
  if (!stable) {
    stable = uuid();
    write(globalThis.localStorage, STABLE_KEY, stable);
  }
  const own = read(globalThis.sessionStorage, TAB_KEY);
  // The same tab (reload / navigation) still carries its window.name mark; a Duplicate or window.open copy does not.
  const sameTab = !!own && window.name === TAB_NAME_PREFIX + own;

  let id: string | null = null;
  let how = "";
  if (own && sameTab && (await hold(own, RELOAD_WAIT_MS))) {
    id = own;
    how = "tab (kept)";
  } else if (own && !sameTab && (await holdIfFreeAndIdle(own))) {
    // A copy (or a restored tab) whose original is gone: the id is free and nobody is reloading into it.
    id = own;
    how = "tab (copy, free)";
  } else if (own !== stable && (await holdIfFreeAndIdle(stable))) {
    id = stable;
    how = "stable";
  } else {
    const fresh = uuid();
    // A just-generated uuid is never held elsewhere; still claim it so a later duplicate of THIS tab is caught.
    await hold(fresh, RELOAD_WAIT_MS);
    id = fresh;
    how = "fresh";
  }

  write(globalThis.sessionStorage, TAB_KEY, id);
  try {
    window.name = TAB_NAME_PREFIX + id;
  } catch {
    /* ignore */
  }
  write(globalThis.localStorage, HANDOFF_PREFIX + id, null);
  pruneHandoffs();
  // On unload (reload or close — indistinguishable) leave a short handoff marker so a tab opening or a copy of this
  // tab loading during the reload does not grab this id from under the returning tab.
  const claimedId = id;
  window.addEventListener("pagehide", () => {
    write(globalThis.localStorage, HANDOFF_PREFIX + claimedId, String(Date.now()));
  });
  console.log(`[SyncBiz] device_id (${how}):`, id);
  return id;
}

/** Claim this tab's deviceId (idempotent; resolves once the Web Lock decision is final). */
export function claimDeviceId(): Promise<string> {
  if (!claimPromise) {
    claimPromise = runClaim().then((id) => {
      claimed = id;
      return id;
    });
  }
  return claimPromise;
}

/** This tab's deviceId once claimDeviceId() has resolved; null before that (never an unclaimed id). */
export function getClaimedDeviceId(): string | null {
  return claimed;
}

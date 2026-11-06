/**
 * READ-ONLY diagnostic for the Live Queue squares (owner 2026-11-05): on the Windows PCs the cover squares of the "next songs" list jump / re-appear late, also when nothing is
 * touched and while scrolling — not reproducible on macOS. Same pattern as lib/desktop-perf-diag.ts: in the desktop shell the main.log keeps the renderer's warn / error lines,
 * so this writes (as warn lines, tag `[VONO queue-diag]`) only what moves, event-driven, rate-limited, nothing stored or sent and nothing changed:
 *   - flip      : a cover / row the FLIP pass glides (kind row / s / pn, how far, how much it scaled) — the hook is one call inside the panel's FLIP pass;
 *   - rows      : rows added to / removed from the list (a remount replays the entrance animation);
 *   - anim      : the CSS animations that start inside the list (names + counts);
 *   - image     : a cover that finished loading (size in pixels, kind of source — never the address — and its network time);
 *   - late cover: a cover that scrolled into view and needed >= 60 ms to decode, or was still loading;
 *   - summary   : once a minute, only if something happened.
 * Active in the desktop shell, or in any browser that set localStorage "syncbiz-queuediag" = "1" (lines go to the DevTools console).
 * REMOVE (or keep, owner's call) once the squares question is answered.
 */

const TAG = "[VONO queue-diag] ";
const MAX_LINES_PER_MINUTE = 12;
const MAX_LINES_PER_SESSION = 300;
const SUMMARY_EVERY_MS = 60_000;
const SLOW_DECODE_MS = 60;
const BODY = ".sb-queue-body";
const ROW = "li.sb-queue-rowline";

let active = false;
let minuteStart = 0;
let minuteLines = 0;
let sessionLines = 0;
let dropped = 0;
const stats = {
  flips: 0,
  flipKinds: {} as Record<string, number>,
  rowsAdded: 0,
  rowsRemoved: 0,
  anims: {} as Record<string, number>,
  images: 0,
  bigImages: 0,
  late: 0,
  worstDecode: 0,
};

function emit(step: string, data: Record<string, unknown>): void {
  const now = Date.now();
  if (now - minuteStart >= 60_000) {
    minuteStart = now;
    minuteLines = 0;
  }
  if (minuteLines >= MAX_LINES_PER_MINUTE || sessionLines >= MAX_LINES_PER_SESSION) {
    dropped++;
    return;
  }
  minuteLines++;
  sessionLines++;
  try {
    console.warn(TAG + step + " " + JSON.stringify(dropped > 0 ? { ...data, droppedBefore: dropped } : data));
    dropped = 0;
  } catch {
    /* ignore */
  }
}

function isDesktopShell(): boolean {
  return typeof window !== "undefined" && "syncbizDesktop" in window;
}

function optedIn(): boolean {
  try {
    return window.localStorage.getItem("syncbiz-queuediag") === "1";
  } catch {
    return false;
  }
}

/** What kind of address a cover has — never the address itself (it can be a local path / a signed URL). */
function srcKind(src: string): string {
  if (!src) return "none";
  if (src.startsWith("data:")) return "data";
  if (src.startsWith("blob:")) return "blob";
  try {
    const u = new URL(src, window.location.href);
    if (u.hostname.endsWith("ytimg.com") || u.hostname.endsWith("youtube.com")) return "youtube";
    if (u.protocol === "file:") return "file";
    return u.hostname === window.location.hostname ? "own" : "other";
  } catch {
    return "other";
  }
}

/** One call from the panel's FLIP pass: a glide is about to start. No-op unless the diagnostic is running. */
export function queueDiagFlip(key: string, dx: number, dy: number, sx: number, sy: number): void {
  if (!active) return;
  stats.flips++;
  const kind = key.split(":")[0] || "?";
  stats.flipKinds[kind] = (stats.flipKinds[kind] ?? 0) + 1;
  emit("flip", { kind, dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10, sx: Math.round(sx * 1000) / 1000, sy: Math.round(sy * 1000) / 1000 });
}

export function startQueueDiag(): () => void {
  if (active || typeof window === "undefined" || !(isDesktopShell() || optedIn())) return () => undefined;
  active = true;
  minuteStart = Date.now();

  const seenImg = new WeakSet<HTMLImageElement>();
  let watched: Element | null = null;
  let mo: MutationObserver | null = null;
  let io: IntersectionObserver | null = null;
  let rowBatchTimer = 0;
  let batchAdded = 0;
  let batchRemoved = 0;

  const flushRows = (): void => {
    rowBatchTimer = 0;
    if (batchAdded || batchRemoved) emit("rows", { added: batchAdded, removed: batchRemoved });
    batchAdded = 0;
    batchRemoved = 0;
  };

  const watchImg = (img: HTMLImageElement): void => {
    if (seenImg.has(img)) return;
    seenImg.add(img);
    io?.observe(img);
  };

  const scanImages = (root: ParentNode): void => {
    root.querySelectorAll?.("img").forEach((im) => watchImg(im as HTMLImageElement));
  };

  const attach = (): void => {
    const body = document.querySelector(BODY);
    if (body === watched) return;
    mo?.disconnect();
    watched = body;
    if (!body) return;
    mo = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          const rows = (n.matches(ROW) ? 1 : 0) + n.querySelectorAll(ROW).length;
          if (rows) {
            batchAdded += rows;
            stats.rowsAdded += rows;
          }
          if (n instanceof HTMLImageElement) watchImg(n);
          else scanImages(n);
        });
        r.removedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          const rows = (n.matches(ROW) ? 1 : 0) + n.querySelectorAll(ROW).length;
          if (rows) {
            batchRemoved += rows;
            stats.rowsRemoved += rows;
          }
        });
      }
      if ((batchAdded || batchRemoved) && !rowBatchTimer) rowBatchTimer = window.setTimeout(flushRows, 1000);
    });
    mo.observe(body, { childList: true, subtree: true });
    scanImages(body);
  };

  if (typeof IntersectionObserver !== "undefined") {
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const img = e.target as HTMLImageElement;
          io?.unobserve(img); // the first time this very element comes into view: that is when its decode is paid
          const t0 = performance.now();
          const wasComplete = img.complete && img.naturalWidth > 0;
          const finish = (): void => {
            const ms = Math.round(performance.now() - t0);
            if (ms >= SLOW_DECODE_MS || !wasComplete) {
              stats.late++;
              stats.worstDecode = Math.max(stats.worstDecode, ms);
              emit("late cover", { ms, loadedBeforeVisible: wasComplete, w: img.naturalWidth, h: img.naturalHeight, kind: srcKind(img.currentSrc || img.src) });
            }
          };
          if (typeof img.decode === "function") img.decode().then(finish, finish);
          else finish();
        }
      },
      { threshold: 0.01 },
    );
  }

  // covers finishing their load (the event does not bubble — capture it on the document)
  const onLoad = (ev: Event): void => {
    const t = ev.target;
    if (!(t instanceof HTMLImageElement) || !t.closest(BODY)) return;
    stats.images++;
    const w = t.naturalWidth;
    const h = t.naturalHeight;
    const big = Math.max(w, h) > 400;
    if (big) stats.bigImages++;
    let net: number | null = null;
    try {
      const entry = performance.getEntriesByName(t.currentSrc || t.src).pop() as PerformanceResourceTiming | undefined;
      if (entry) net = Math.round(entry.responseEnd - entry.startTime);
    } catch {
      /* ignore */
    }
    if (big || (net !== null && net > 800)) emit("image", { w, h, kind: srcKind(t.currentSrc || t.src), netMs: net });
  };
  document.addEventListener("load", onLoad, true);

  // CSS animations that start inside the list (the entrance animations replay when a row is mounted again)
  const onAnim = (ev: Event): void => {
    const t = ev.target;
    if (!(t instanceof Element) || !t.closest(BODY)) return;
    const name = (ev as AnimationEvent).animationName || "?";
    stats.anims[name] = (stats.anims[name] ?? 0) + 1;
  };
  document.addEventListener("animationstart", onAnim, true);

  attach();
  const reattach = window.setInterval(attach, 2000); // the list can be re-created (mirror <-> local, a route change)

  const summary = window.setInterval(() => {
    const any = stats.flips || stats.rowsAdded || stats.rowsRemoved || stats.images || stats.late || Object.keys(stats.anims).length;
    if (!any) return;
    emit("summary 1 min", {
      flips: stats.flips,
      flipKinds: stats.flipKinds,
      rowsAdded: stats.rowsAdded,
      rowsRemoved: stats.rowsRemoved,
      anims: stats.anims,
      images: stats.images,
      bigImages: stats.bigImages,
      lateCovers: stats.late,
      worstDecodeMs: stats.worstDecode,
    });
    stats.flips = 0;
    stats.flipKinds = {};
    stats.rowsAdded = 0;
    stats.rowsRemoved = 0;
    stats.anims = {};
    stats.images = 0;
    stats.bigImages = 0;
    stats.late = 0;
    stats.worstDecode = 0;
  }, SUMMARY_EVERY_MS);

  return () => {
    active = false;
    document.removeEventListener("load", onLoad, true);
    document.removeEventListener("animationstart", onAnim, true);
    window.clearInterval(reattach);
    window.clearInterval(summary);
    if (rowBatchTimer) window.clearTimeout(rowBatchTimer);
    mo?.disconnect();
    io?.disconnect();
  };
}

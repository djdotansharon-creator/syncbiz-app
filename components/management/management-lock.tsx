"use client";

/**
 * MANAGEMENT LOCK — client pieces (owner 2026-10-13, security hotfix). Desktop station only:
 *   ManagementLockScreen  — "Management is locked": manager password → unlock (server re-auth, rate-limited) ·
 *                           "Back to Player" always open (no password).
 *   ManagementActivity    — real user activity (pointer / key / wheel / touch) extends the unlock (at most once a
 *                           minute); 15 min without activity → lock now. Background polling never extends it.
 * Never touches playback: locking only swaps the management page for the lock screen.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const IDLE_MS = 15 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000;

export function ManagementLockScreen() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlock = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/management-unlock", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string; retryAfterSec?: number };
      if (!res.ok) {
        setError(res.status === 429 ? `Too many attempts. Try again in ${Math.ceil((d.retryAfterSec ?? 900) / 60)} min.` : d.error ?? "Could not unlock.");
        setPassword("");
        return;
      }
      setPassword("");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center p-6">
      <form
        className="w-full max-w-sm border border-[color:var(--vx-line-strong,rgba(255,255,255,0.16))] bg-[#0e0e11] p-6 text-white"
        onSubmit={(e) => { e.preventDefault(); void unlock(); }}
      >
        <div className="flex items-center gap-2 text-white/60">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="4" y="11" width="16" height="10" rx="1" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          <span className="text-xs font-semibold uppercase tracking-[0.08em]">Management locked</span>
        </div>
        <h1 className="mt-3 text-xl font-semibold">Manager sign-in required</h1>
        <p className="mt-1 text-sm text-white/60">This is a station computer. Enter your manager password to open management.</p>
        <label className="mt-5 block">
          <span className="text-xs text-white/50">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            className="mt-1 w-full border-0 border-b-2 border-white/15 bg-white/[0.04] px-3 py-2.5 text-base text-white focus:border-[#0a84ff] focus:outline-none"
          />
        </label>
        {error ? <p className="mt-3 text-sm text-amber-300" role="alert">{error}</p> : null}
        <div className="mt-6 flex items-center justify-between gap-3">
          <Link href="/sources" className="text-sm text-white/60 hover:text-white">← Back to Player</Link>
          <button type="submit" disabled={!password || busy} className="bg-white px-5 py-2 text-sm font-semibold text-black disabled:opacity-40">
            {busy ? "Checking…" : "Unlock"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Desktop station, unlocked: activity extends the unlock; 15 min idle → lock (the page re-renders as the lock screen). */
export function ManagementActivity() {
  const router = useRouter();
  const lastActivity = useRef(0);
  const lastTouch = useRef(0);

  useEffect(() => {
    lastActivity.current = Date.now();
    lastTouch.current = Date.now();
    const onActivity = () => {
      const now = Date.now();
      lastActivity.current = now;
      if (now - lastTouch.current >= TOUCH_EVERY_MS) {
        lastTouch.current = now;
        void fetch("/api/auth/management-unlock", { method: "PUT", credentials: "include" }).catch(() => {});
      }
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const id = window.setInterval(() => {
      if (Date.now() - lastActivity.current >= IDLE_MS) {
        window.clearInterval(id);
        void fetch("/api/auth/management-unlock", { method: "DELETE", credentials: "include" })
          .catch(() => {})
          .finally(() => router.refresh());
      }
    }, 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      window.clearInterval(id);
    };
  }, [router]);

  return null;
}

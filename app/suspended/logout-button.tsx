"use client";

/**
 * Sign-out trigger for the /suspended page.
 *
 * Server-rendered page can't directly call POST /api/auth/logout, and
 * we don't want to add a generic global logout button just for this
 * surface. This is a tiny client island scoped to /suspended that calls
 * the existing logout endpoint and redirects to /login.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });
    } catch {
      // Even if the network fails, sending the user to /login is the safe fallback —
      // they can sign back in and the next request will re-issue a clean cookie.
    } finally {
      router.replace("/login");
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded border border-neutral-700 bg-neutral-800/60 px-3 py-1.5 text-[12px] font-medium text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}

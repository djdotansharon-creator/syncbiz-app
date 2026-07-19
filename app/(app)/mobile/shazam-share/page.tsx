"use client";

import { useEffect } from "react";

/**
 * Web Share Target receiver. The PWA manifest's `share_target` points here, so
 * when a user shares a link from Shazam (or anywhere) into an installed SyncBiz,
 * Android navigates to this route with the shared title/text/url as query
 * params. We pull out the first URL, stash it, and hand off to the mobile Search
 * screen where the existing Import-from-Shazam flow resolves it → YouTube.
 *
 * Uses window.location (not useSearchParams) so no Suspense boundary is needed.
 */
export default function ShazamShareReceiverPage() {
  useEffect(() => {
    let link = "";
    try {
      const p = new URLSearchParams(window.location.search);
      const blob = `${p.get("url") ?? ""} ${p.get("text") ?? ""} ${p.get("title") ?? ""}`;
      const m = blob.match(/https?:\/\/[^\s]+/i);
      link = m ? m[0] : "";
      if (link) sessionStorage.setItem("syncbiz:shazamShareLink", link);
    } catch {
      /* ignore */
    }
    // Replace so the share URL never stays in history.
    window.location.replace("/mobile/search");
  }, []);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 text-center text-sm text-slate-400">
      Opening SyncBiz…
    </div>
  );
}

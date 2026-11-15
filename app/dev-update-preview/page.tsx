"use client";

/**
 * LOCAL-ONLY preview (NOT part of any PR — keep untracked): lets a normal browser (Safari / Chrome) show the Windows app's "Update" button + card.
 * The button exists only inside the desktop app (it looks for window.syncbizDesktop), so this page installs a stand-in for that bridge ("I am the Windows
 * app, version 2.3.1") and asks the download endpoint as Windows (a Mac browser would otherwise be answered with the macOS build).
 */
import { useEffect, useState } from "react";
import { DesktopUpdatePill } from "@/components/desktop-update-pill";
import { useLocale } from "@/lib/locale-context";

export default function DevUpdatePreview() {
  const [ready, setReady] = useState(false);
  const [look, setLook] = useState<"song" | "white">("song");
  const { locale, setLocale } = useLocale();

  useEffect(() => {
    const w = window as unknown as { syncbizDesktop?: unknown };
    const hadBridge = !!w.syncbizDesktop;
    if (!hadBridge) {
      w.syncbizDesktop = new Proxy({}, {
        get: (_t, k) => (k === "getAppVersion" ? async () => "2.3.1" : typeof k === "string" && /^on[A-Z]/.test(k) ? () => () => {} : async () => null),
        has: () => true,
      });
    }
    const orig = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return u.includes("/api/desktop/download") ? orig(u + (u.includes("?") ? "&" : "?") + "platform=win", init) : orig(input, init);
    };
    setReady(true);
    return () => {
      window.fetch = orig;
      if (!hadBridge) delete w.syncbizDesktop;
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-sb-display", look);
  }, [look]);

  const white = look === "white";
  return (
    <div style={{ minHeight: "100vh", background: white ? "#eceef1" : "#000", color: white ? "#1c1c1e" : "#f5f5f7" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, height: 56, padding: "0 20px", background: white ? "rgba(247,248,251,0.94)" : "#0b0b0c" }}>
        <strong style={{ letterSpacing: "0.12em" }}>VONO</strong>
        {ready ? <DesktopUpdatePill /> : null}
      </header>
      <main style={{ padding: "28px 20px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 520 }}>
        <p style={{ opacity: 0.7, fontSize: 14, lineHeight: 1.5 }}>
          Local preview of the update button. Click the amber button next to the logo. A click anywhere else (or Escape) folds it back; reload the page to see the opening again.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setLook("song")} style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid currentColor", background: "transparent", color: "inherit" }}>Dark look</button>
          <button type="button" onClick={() => setLook("white")} style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid currentColor", background: "transparent", color: "inherit" }}>White look</button>
          <button type="button" onClick={() => setLocale(locale === "he" ? "en" : "he")} style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid currentColor", background: "transparent", color: "inherit" }}>{locale === "he" ? "English" : "עברית"}</button>
          <a href="/whats-new" target="_blank" rel="noopener noreferrer" style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid currentColor", color: "inherit", textDecoration: "none" }}>Open the What&apos;s new page</a>
        </div>
      </main>
    </div>
  );
}

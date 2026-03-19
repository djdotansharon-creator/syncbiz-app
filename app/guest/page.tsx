"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { getWsUrl } from "@/lib/remote-control/ws-client";

function GuestForm() {
  const searchParams = useSearchParams();
  const codeFromUrl = searchParams.get("code") ?? "";
  const [sessionCode, setSessionCode] = useState(codeFromUrl);
  const [sourceUrl, setSourceUrl] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestMessage, setGuestMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (codeFromUrl) setSessionCode(codeFromUrl.toUpperCase());
  }, [codeFromUrl]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const code = sessionCode.trim().toUpperCase();
      const url = sourceUrl.trim();
      if (!code) {
        setErrorMessage("Session code is required");
        return;
      }
      if (!url || !url.startsWith("http")) {
        setErrorMessage("Please enter a valid URL (playlist or source)");
        return;
      }
      setStatus("sending");
      setErrorMessage(null);
      const wsUrl = getWsUrl();
      if (!wsUrl) {
        setStatus("error");
        setErrorMessage("Connection unavailable");
        return;
      }
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "GUEST_RECOMMEND",
            sessionCode: code,
            sourceUrl: url,
            guestName: guestName.trim() || undefined,
            guestMessage: guestMessage.trim() || undefined,
          })
        );
      };
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data as string);
          if (data.type === "GUEST_RECOMMEND_SENT") {
            setStatus("success");
            setSourceUrl("");
            setGuestMessage("");
          } else if (data.type === "ERROR") {
            setStatus("error");
            setErrorMessage(data.message ?? "Failed to send");
          }
        } catch {
          setStatus("error");
          setErrorMessage("Invalid response");
        }
        ws.close();
      };
      ws.onerror = () => {
        setStatus("error");
        setErrorMessage("Connection failed");
      };
      ws.onclose = () => {};
    },
    [sessionCode, sourceUrl, guestName, guestMessage]
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-2">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/10 text-lg font-semibold text-amber-400 ring-1 ring-amber-500/40">
            SB
          </span>
          <span className="text-xl font-semibold tracking-tight text-slate-50">
            SyncBiz Guest
          </span>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-8 shadow-xl">
          <h1 className="text-lg font-semibold text-slate-50">Recommend a track</h1>
          <p className="mt-1 text-sm text-slate-400">
            Suggest a playlist or source to the operator. They will review and approve before it plays.
          </p>
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="code" className="block text-xs font-medium text-slate-300">
                Session code
              </label>
              <input
                id="code"
                type="text"
                value={sessionCode}
                onChange={(e) => setSessionCode(e.target.value.toUpperCase())}
                placeholder="e.g. ABC123"
                maxLength={6}
                className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-50 placeholder:text-slate-500 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30 uppercase"
              />
            </div>
            <div>
              <label htmlFor="url" className="block text-xs font-medium text-slate-300">
                Playlist or source URL <span className="text-rose-400">*</span>
              </label>
              <input
                id="url"
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://youtube.com/playlist?list=..."
                required
                className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-50 placeholder:text-slate-500 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30"
              />
            </div>
            <div>
              <label htmlFor="name" className="block text-xs font-medium text-slate-300">
                Your name <span className="text-slate-500">(optional)</span>
              </label>
              <input
                id="name"
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Nickname"
                className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-50 placeholder:text-slate-500 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30"
              />
            </div>
            <div>
              <label htmlFor="message" className="block text-xs font-medium text-slate-300">
                Message <span className="text-slate-500">(optional)</span>
              </label>
              <textarea
                id="message"
                value={guestMessage}
                onChange={(e) => setGuestMessage(e.target.value)}
                placeholder="e.g. Great for the afternoon vibe"
                rows={2}
                className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-50 placeholder:text-slate-500 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30 resize-none"
              />
            </div>
            {errorMessage && (
              <p className="text-sm text-rose-400">{errorMessage}</p>
            )}
            {status === "success" && (
              <p className="text-sm text-emerald-400">Recommendation sent. The operator will review it.</p>
            )}
            <button
              type="submit"
              disabled={status === "sending"}
              className="mt-4 flex w-full items-center justify-center rounded-xl bg-amber-500 py-2.5 text-sm font-medium text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400 disabled:opacity-50"
            >
              {status === "sending" ? "Sending…" : "Send recommendation"}
            </button>
          </form>
        </div>
        <p className="mt-6 text-center text-xs text-slate-500">
          Ask the operator for the session code and share link.
        </p>
      </div>
    </div>
  );
}

export default function GuestPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
          <p className="text-slate-500">Loading…</p>
        </div>
      }
    >
      <GuestForm />
    </Suspense>
  );
}

"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = (searchParams.get("token") ?? "").trim();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");
  /** Set only in development when the API returns a reset URL (no email is sent). */
  const [devOnlyResetUrl, setDevOnlyResetUrl] = useState<string | null>(null);

  const isResetMode = token.length > 0;

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setMessage("");
    try {
      setDevOnlyResetUrl(null);
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { message?: string; resetUrl?: string };
      if (!res.ok) {
        setStatus("error");
        setMessage("Failed to request reset");
        return;
      }
      setStatus("ok");
      if (data.resetUrl) {
        setDevOnlyResetUrl(data.resetUrl);
        setMessage(
          "Local development: email is not sent. Use the link below to set a new password. On production (e.g. Railway) with RESEND_API_KEY, a real email is sent instead.",
        );
      } else {
        setMessage(
          data.message ??
            "If that account exists, we sent a password reset email. Check your inbox and spam folder.",
        );
      }
    } catch {
      setStatus("error");
      setMessage("Failed to request reset");
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "Failed to reset password");
        return;
      }
      setStatus("ok");
      setMessage("Password reset successful. You can now log in.");
    } catch {
      setStatus("error");
      setMessage("Failed to reset password");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950/70 p-8 shadow-xl">
        <h1 className="text-lg font-semibold text-slate-50">
          {isResetMode ? "Set new password" : "Forgot password"}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {isResetMode
            ? "Enter a new password for your account."
            : "Enter your email and we'll send a reset link."}
        </p>

        {!isResetMode ? (
          <form className="mt-6 space-y-4" onSubmit={handleRequest}>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-50 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30"
            />
            <button
              type="submit"
              disabled={status === "loading"}
              className="w-full rounded-xl bg-sky-500 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-sky-400 disabled:opacity-50"
            >
              {status === "loading" ? "Sending..." : "Send reset link"}
            </button>
          </form>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleReset}>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password (min 6 chars)"
              className="w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-50 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30"
            />
            <button
              type="submit"
              disabled={status === "loading"}
              className="w-full rounded-xl bg-sky-500 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-sky-400 disabled:opacity-50"
            >
              {status === "loading" ? "Updating..." : "Update password"}
            </button>
          </form>
        )}

        {message ? (
          <div className={`mt-4 space-y-2 text-sm ${status === "error" ? "text-rose-400" : "text-emerald-300"}`}>
            <p className="whitespace-pre-wrap">{message}</p>
            {devOnlyResetUrl ? (
              <a
                href={devOnlyResetUrl}
                className="block break-all font-mono text-xs text-sky-300 underline hover:text-sky-200"
              >
                {devOnlyResetUrl}
              </a>
            ) : null}
          </div>
        ) : null}

        <p className="mt-6 text-center text-sm text-slate-400">
          <Link href="/login" className="font-medium text-sky-400 hover:text-sky-300">
            Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}


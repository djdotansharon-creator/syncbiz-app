"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const firstName = String(form.get("first-name") ?? "").trim();
    const lastName = String(form.get("last-name") ?? "").trim();
    const company = String(form.get("company") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, company, email, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Signup failed");
        return;
      }
      router.push("/login");
      router.refresh();
    } catch {
      setError("Signup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4">
      <div className="grid w-full max-w-5xl grid-cols-1 overflow-hidden rounded-3xl border border-slate-800 bg-slate-950/60 shadow-2xl shadow-black/40 backdrop-blur-xl md:grid-cols-[1.1fr,1fr]">
        <div className="flex flex-col justify-center bg-slate-950/80 p-8 md:p-10">
          <div className="space-y-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-400/90">
                Get started
              </p>
              <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-50">
                Create your SyncBiz workspace
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                Add your devices and schedules to get started.
              </p>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label
                    htmlFor="first-name"
                    className="text-xs font-medium text-slate-200"
                  >
                    First name
                  </label>
                  <input
                    id="first-name"
                    name="first-name"
                    placeholder="Ada"
                    className="w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-50 outline-none ring-0 transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40"
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="last-name"
                    className="text-xs font-medium text-slate-200"
                  >
                    Last name
                  </label>
                  <input
                    id="last-name"
                    name="last-name"
                    placeholder="Lovelace"
                    className="w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-50 outline-none ring-0 transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="company"
                  className="text-xs font-medium text-slate-200"
                >
                  Company
                </label>
                <input
                  id="company"
                  name="company"
                  placeholder="Acme Inc."
                  className="w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-50 outline-none ring-0 transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="email"
                  className="text-xs font-medium text-slate-200"
                >
                  Work email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@company.com"
                  className="w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-50 outline-none ring-0 transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="password"
                  className="text-xs font-medium text-slate-200"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Create a strong password"
                    className="w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 pr-10 text-sm text-slate-50 outline-none ring-0 transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 transition hover:text-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-start gap-2 pt-1 text-xs text-slate-400">
                <input
                  id="terms"
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5 rounded border-slate-700 bg-slate-900/80 text-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
                />
                <label htmlFor="terms" className="space-x-1">
                  <span>By creating an account you agree to our</span>
                  <button
                    type="button"
                    className="font-medium text-sky-300 hover:text-sky-200"
                  >
                    Terms
                  </button>
                  <span>and</span>
                  <button
                    type="button"
                    className="font-medium text-sky-300 hover:text-sky-200"
                  >
                    Privacy Policy
                  </button>
                  .
                </label>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-medium text-slate-950 shadow-lg shadow-sky-500/30 transition hover:bg-sky-400"
              >
                {loading ? "Creating..." : "Create workspace"}
              </button>
              {error ? <p className="text-xs text-red-400">{error}</p> : null}
            </form>

          <p className="pt-2 text-center text-xs text-slate-400">
            Already using SyncBiz?{" "}
            <Link
              href="/login"
              className="font-medium text-sky-300 hover:text-sky-200"
            >
              Log in
            </Link>
          </p>
          <p className="pt-2 text-center">
            <Link href="/" className="text-xs text-slate-500 hover:text-slate-400">
              ← Back to home
            </Link>
          </p>
          </div>
        </div>

        <div className="relative hidden flex-col justify-between border-l border-slate-800 bg-gradient-to-br from-sky-500/15 via-cyan-400/5 to-emerald-400/15 p-8 md:flex">
          <div className="space-y-4">
            <p className="inline-flex items-center rounded-full bg-slate-950/40 px-3 py-1 text-xs font-medium text-sky-200 ring-1 ring-sky-500/40">
              Built for branch media operations
            </p>
            <h2 className="max-w-xs text-2xl font-semibold tracking-tight text-slate-50">
              Schedule what plays,
              <br />
              control where it plays.
            </h2>
            <p className="max-w-sm text-xs text-slate-100/95">
              Point SyncBiz at your existing content libraries and in-store
              devices. We orchestrate local agents to play the right audio,
              video, and announcements at the right time — without providing or
              hosting media.
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-slate-700/80 bg-slate-950/60 p-3">
                <p className="text-[11px] font-medium text-slate-100">
                  Time to insight
                </p>
                <p className="mt-1 text-[11px] text-emerald-300">
                  ↓ 47% in the first 30 days
                </p>
              </div>
              <div className="rounded-2xl border border-slate-700/80 bg-slate-950/60 p-3">
                <p className="text-[11px] font-medium text-slate-100">
                  Manual updates
                </p>
                <p className="mt-1 text-[11px] text-sky-300">
                  100K+ events automated / month
                </p>
              </div>
            </div>
            <p className="text-[11px] text-slate-200/90">
              “SyncBiz lets our operations team run branch media centrally while
              stores keep control over their licensed content.”
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}


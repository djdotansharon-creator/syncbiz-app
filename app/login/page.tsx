import Link from "next/link";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-2">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-500/10 text-lg font-semibold text-sky-400 ring-1 ring-sky-500/40">
            SB
          </span>
          <span className="text-xl font-semibold tracking-tight text-slate-50">
            SyncBiz
          </span>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-8 shadow-xl">
          <h1 className="text-lg font-semibold text-slate-50">Log in</h1>
          <p className="mt-1 text-sm text-slate-400">
            Access your control dashboard. SyncBiz only orchestrates playback – it does not store or stream media.
          </p>
          <form className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-medium text-slate-300"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                placeholder="you@company.com"
                className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-50 placeholder:text-slate-500 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30"
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="block text-xs font-medium text-slate-300"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                placeholder="••••••••"
                className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-50 placeholder:text-slate-500 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30"
              />
            </div>
            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 text-slate-400">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 text-sky-500 focus:ring-sky-500/30"
                />
                Remember me
              </label>
              <button
                type="button"
                className="text-sky-400 hover:text-sky-300"
              >
                Forgot password?
              </button>
            </div>
            <Link
              href="/dashboard"
              className="mt-4 flex w-full items-center justify-center rounded-xl bg-sky-500 py-2.5 text-sm font-medium text-slate-950 shadow-lg shadow-sky-500/20 transition hover:bg-sky-400"
            >
              Continue to dashboard
            </Link>
          </form>
          <p className="mt-6 text-center text-sm text-slate-400">
            New to SyncBiz?{" "}
            <Link
              href="/signup"
              className="font-medium text-sky-400 hover:text-sky-300"
            >
              Create an account
            </Link>
          </p>
        </div>
        <p className="mt-6 text-center">
          <Link href="/" className="text-xs text-slate-500 hover:text-slate-400">
            ← Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}

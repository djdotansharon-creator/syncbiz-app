import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 px-4">
      <div className="flex max-w-lg flex-col items-center text-center">
        <div className="mb-8 flex items-center gap-2">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/10 text-xl font-semibold text-sky-400 ring-1 ring-sky-500/40">
            SB
          </span>
          <span className="text-2xl font-semibold tracking-tight text-slate-50">
            SyncBiz
          </span>
        </div>
        <p className="mb-2 text-sm font-medium uppercase tracking-widest text-sky-400/90">
          Media control & scheduling
        </p>
        <h1 className="mb-4 text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">
          Control and schedule playback
          <br />
          on your devices.
        </h1>
        <p className="mb-10 max-w-md text-slate-400">
          SyncBiz is a controller and scheduler. It sends playback commands to
          customer-owned endpoint devices through a local agent. SyncBiz does
          not store or host media – you own your sources and licensing.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-xl bg-sky-500 px-6 py-3 text-sm font-medium text-slate-950 shadow-lg shadow-sky-500/20 transition hover:bg-sky-400"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900/60 px-6 py-3 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800/60"
          >
            Create account
          </Link>
        </div>
        <p className="mt-8 text-xs text-slate-500">
          Already in?{" "}
          <Link href="/dashboard" className="text-sky-400 hover:text-sky-300">
            Go to dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { MobilePageHeader } from "@/components/mobile/mobile-page-header";
import { useMobileRole } from "@/lib/mobile-role-context";
import { useStationController } from "@/lib/station-controller-context";

/**
 * Mobile Remote tab — the control surface for the phone's role.
 *
 * Responsibilities:
 *   - Let the user pick Controller vs Player mode (persisted via mobile-role-context).
 *   - Show the current WS connection status and which device the phone will drive.
 *   - Provide a quick link to `/remote-player` for users who want to set up a desktop
 *     target from their computer.
 *
 * Playback transport (play/pause/seek) lives in the mini player that stays pinned
 * across every tab — this page is about choosing *what* gets controlled, not the
 * moment-to-moment transport.
 */
export default function MobileRemotePage() {
  const { mobileRole, setMobileRole } = useMobileRole();
  const station = useStationController();

  const isController = mobileRole === "controller";
  const statusColor =
    station.status === "connected"
      ? "bg-emerald-500/20 text-emerald-300 ring-emerald-500/40"
      : station.status === "connecting"
        ? "bg-amber-500/20 text-amber-300 ring-amber-500/40"
        : "bg-slate-500/20 text-slate-400 ring-slate-500/30";

  const selectedDevice = station.devices.find((d) => d.id === station.selectedDeviceId);
  const masterDevice = station.devices.find((d) => d.mode === "MASTER");
  const targetDevice = selectedDevice ?? masterDevice ?? null;

  return (
    <>
      <MobilePageHeader title="Remote" showModePill />

      <div className="px-4 py-4 pb-8">
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Mode</h2>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-800/80 bg-slate-900/40 p-1.5">
            <button
              type="button"
              onClick={() => setMobileRole("controller")}
              aria-pressed={isController}
              className={`rounded-lg px-3 py-3 text-left transition ${
                isController
                  ? "bg-sky-500/15 ring-1 ring-sky-500/50"
                  : "hover:bg-slate-800/60"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/25 text-sky-300">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <rect x="6" y="2" width="12" height="20" rx="3" />
                    <circle cx="12" cy="18" r="1" fill="currentColor" stroke="none" />
                  </svg>
                </span>
                <span className={`text-sm font-semibold ${isController ? "text-sky-100" : "text-slate-200"}`}>
                  Controller
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                Drive the desktop player. Phone is a remote.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setMobileRole("player")}
              aria-pressed={!isController}
              className={`rounded-lg px-3 py-3 text-left transition ${
                !isController
                  ? "bg-amber-500/10 ring-1 ring-amber-500/50"
                  : "hover:bg-slate-800/60"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/25 text-amber-300">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                  </svg>
                </span>
                <span className={`text-sm font-semibold ${!isController ? "text-amber-100" : "text-slate-200"}`}>
                  Player
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                Play on this phone. Audio comes from here.
              </p>
            </button>
          </div>
        </section>

        {isController && (
          <section className="mb-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Connection</h2>
            <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
              <div className="mb-3 flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${statusColor}`}
                >
                  {station.status}
                </span>
                <span className="text-xs text-slate-500">
                  {station.devices.length} device{station.devices.length === 1 ? "" : "s"}
                </span>
              </div>

              {station.status !== "connected" ? (
                <p className="text-sm text-slate-400">
                  Connecting to SyncBiz network…
                </p>
              ) : station.devices.length === 0 ? (
                <div className="text-sm text-slate-400">
                  <p className="mb-2">No player is online.</p>
                  <p className="text-xs text-slate-500">
                    Open{" "}
                    <Link href="/remote-player" className="font-medium text-sky-400 hover:underline">
                      Remote Player
                    </Link>{" "}
                    on your computer or launch the SyncBiz desktop app.
                  </p>
                </div>
              ) : targetDevice ? (
                <div>
                  <p className="text-xs uppercase tracking-wider text-slate-500">Controlling</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-100">
                    {targetDevice.mode === "MASTER" ? "Main Player" : `Player (${targetDevice.mode})`}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500 truncate">ID: {targetDevice.id}</p>
                </div>
              ) : (
                <p className="text-sm text-slate-400">
                  No primary player selected yet.
                </p>
              )}
            </div>
          </section>
        )}

        {!isController && (
          <section className="mb-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Playing on</h2>
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <p className="text-sm font-semibold text-amber-100">This phone</p>
              <p className="mt-1 text-[11px] text-slate-400">
                Use the mini player below or the Library / Search tabs to start a source.
                Switching back to Controller stops phone playback.
              </p>
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Tips</h2>
          <ul className="space-y-1.5 text-[11px] leading-relaxed text-slate-400">
            <li>
              <span className="text-slate-300">Controller mode</span> sends play/pause/seek to your
              desktop SyncBiz player in real time.
            </li>
            <li>
              <span className="text-slate-300">Player mode</span> plays in the browser on this phone;
              audio will stop if you navigate away from the app.
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}

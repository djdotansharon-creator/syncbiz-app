"use client";

import type { ReactNode } from "react";
import { PlaybackProvider } from "@/lib/playback-provider";
import { LocaleProvider, type Locale } from "@/lib/locale-context";
import { LibraryThemeProvider } from "@/lib/library-theme-context";
import { MobileRoleProvider } from "@/lib/mobile-role-context";
import { DevicePlayerProvider } from "@/lib/device-player-context";
import { ScheduleEngineProvider } from "@/lib/schedule-engine-context";
import { ScheduleAutoPlayer } from "@/components/schedule-auto-player";
import { JingleScheduleAutoPlayer } from "@/components/jingles-control/JingleScheduleAutoPlayer";
import { AutoplayRecommender } from "@/components/autoplay-recommender";
import { PlayerAutoCompact } from "@/components/player-auto-compact";
import { HarnessPlaybackProbe } from "@/components/harness-playback-probe";
import { PocOfflineLauncher } from "@/components/poc-offline/poc-offline-launcher";
import { MasterMediaSession } from "@/components/master-media-session";
import { DesktopPerfDiag } from "@/components/desktop-perf-diag";
import { PrivateBankGuard } from "@/components/private-bank-guard";

/**
 * Single client boundary for all app providers.
 * Consolidating providers here avoids ChunkLoadError from multiple client boundaries
 * and ensures consistent loading on /mobile and /remote-player.
 */
export function AppProviders({ children, locale }: { children: ReactNode; /** the language the server rendered this page in (locale cookie) — see LocaleProvider */ locale?: Locale }) {
  return (
    <PlaybackProvider>
      <ScheduleEngineProvider>
        <LocaleProvider initialLocale={locale}>
          <LibraryThemeProvider>
            <MobileRoleProvider>
              <DevicePlayerProvider>
                {children}
                <ScheduleAutoPlayer />
                {/* owner 2026-11-11: a switched-off private bank → the station moves to its fallback music after the 04:00 close, at a song boundary (station window only, renders null) */}
                <PrivateBankGuard />
                <JingleScheduleAutoPlayer />
                {/* round 8: a lone YouTube song is followed by what YouTube recommends (fills Play Next; renders null) */}
                <AutoplayRecommender />
                <PlayerAutoCompact />
                {/* Read-only diagnostic probe for the P1.1 playback harness (dev-only, renders null). */}
                <HarnessPlaybackProbe />
                {/* POC-only offline launcher (Stage 2b) — desktop-gated, renders null, registers a manual trigger. */}
                <PocOfflineLauncher />
                {/* Stage A.1 — MASTER acquires + refreshes its own Media Session Token (renders null). */}
                <MasterMediaSession />
                {/* READ-ONLY performance diagnostic (renders null): slow clicks / long frames / hardware → the desktop main.log. Desktop shell or localStorage "syncbiz-perfdiag"="1" only. */}
                <DesktopPerfDiag />
              </DevicePlayerProvider>
            </MobileRoleProvider>
          </LibraryThemeProvider>
        </LocaleProvider>
      </ScheduleEngineProvider>
    </PlaybackProvider>
  );
}

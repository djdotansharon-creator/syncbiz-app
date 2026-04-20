"use client";

import type { ReactNode } from "react";
import { PlaybackProvider } from "@/lib/playback-provider";
import { LocaleProvider } from "@/lib/locale-context";
import { LibraryThemeProvider } from "@/lib/library-theme-context";
import { MobileRoleProvider } from "@/lib/mobile-role-context";
import { DevicePlayerProvider } from "@/lib/device-player-context";
import { ScheduleEngineProvider } from "@/lib/schedule-engine-context";
import { ScheduleAutoPlayer } from "@/components/schedule-auto-player";
import { JingleScheduleAutoPlayer } from "@/components/jingles-control/JingleScheduleAutoPlayer";

/**
 * Single client boundary for all app providers.
 * Consolidating providers here avoids ChunkLoadError from multiple client boundaries
 * and ensures consistent loading on /mobile and /remote-player.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <PlaybackProvider>
      <ScheduleEngineProvider>
        <LocaleProvider>
          <LibraryThemeProvider>
            <MobileRoleProvider>
              <DevicePlayerProvider>
                {children}
                <ScheduleAutoPlayer />
                <JingleScheduleAutoPlayer />
              </DevicePlayerProvider>
            </MobileRoleProvider>
          </LibraryThemeProvider>
        </LocaleProvider>
      </ScheduleEngineProvider>
    </PlaybackProvider>
  );
}

"use client";

import type { ReactNode } from "react";
import { PlaybackProvider } from "@/lib/playback-provider";
import { LocaleProvider } from "@/lib/locale-context";
import { LibraryThemeProvider } from "@/lib/library-theme-context";
import { MobileRoleProvider } from "@/lib/mobile-role-context";
import { DevicePlayerProvider } from "@/lib/device-player-context";

/**
 * Single client boundary for all app providers.
 * Consolidating providers here avoids ChunkLoadError from multiple client boundaries
 * and ensures consistent loading on /mobile and /remote-player.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <PlaybackProvider>
      <LocaleProvider>
        <LibraryThemeProvider>
          <MobileRoleProvider>
            <DevicePlayerProvider>
              {children}
            </DevicePlayerProvider>
          </MobileRoleProvider>
        </LibraryThemeProvider>
      </LocaleProvider>
    </PlaybackProvider>
  );
}

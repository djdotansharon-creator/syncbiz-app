import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { PlaybackProvider } from "@/lib/playback-provider";
import { LocaleProvider } from "@/lib/locale-context";
import { DevicePlayerProvider } from "@/lib/device-player-context";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <PlaybackProvider>
      <LocaleProvider>
        <DevicePlayerProvider>
          <div className="flex min-h-screen flex-col">
            <AppShell>{children}</AppShell>
          </div>
        </DevicePlayerProvider>
      </LocaleProvider>
    </PlaybackProvider>
  );
}

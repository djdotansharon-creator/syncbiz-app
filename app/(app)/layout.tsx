import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { AudioPlayer } from "@/components/audio-player";
import { PlaybackProvider } from "@/lib/playback-provider";
import { LocaleProvider } from "@/lib/locale-context";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <PlaybackProvider>
      <LocaleProvider>
        <div className="flex min-h-screen flex-col">
          <AudioPlayer />
          <AppShell>{children}</AppShell>
        </div>
      </LocaleProvider>
    </PlaybackProvider>
  );
}

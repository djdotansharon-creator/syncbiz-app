import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { PlaybackBar } from "@/components/playback-bar";
import { Player } from "@/components/player";
import { PlaybackProvider } from "@/lib/playback-context";
import { LocaleProvider } from "@/lib/locale-context";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <PlaybackProvider>
      <LocaleProvider>
        <AppShell>{children}</AppShell>
        <Player />
        <PlaybackBar />
      </LocaleProvider>
    </PlaybackProvider>
  );
}

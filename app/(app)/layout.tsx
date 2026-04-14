import type { ReactNode } from "react";
import "@/components/jingles-control/jingles-control.css";
import { AppShell } from "@/components/app-shell";
import { AppProviders } from "./providers";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppProviders>
      <div className="flex min-h-screen flex-col">
        <AppShell>{children}</AppShell>
      </div>
    </AppProviders>
  );
}

"use client";

import { useTr } from "@/lib/i18n/use-tr";
import { VmPage } from "@/components/vm/vm-ui";
import { VmHome } from "@/components/vm/vm-home";

/**
 * HOME — the phone's Home (owner 2026-11-20: "a home like Spotify, instead of the library"). It lives at the old Library address, so every link that said "Library"
 * (the branch's "Pick something to play", the old desktop addresses) lands here; the whole list is at /mobile/library/all.
 */
export default function MobileHomeShelvesPage() {
  const tr = useTr();
  return (
    <VmPage title={tr("Home")}>
      <VmHome />
    </VmPage>
  );
}

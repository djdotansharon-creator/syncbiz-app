"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { useMobileFleet } from "@/lib/mobile-fleet";
import { useTr } from "@/lib/i18n/use-tr";
import { VmPage } from "@/components/vm/vm-ui";
import { VmNowPlaying } from "@/components/vm/vm-now-playing";
import { VmScheduleSwitchLine } from "@/components/vm/vm-schedule-switch";
import { IconChevronBack, IconChevronForward, IconJingle, IconLibrary, IconStore, IconUpNext } from "@/components/vm/vm-icons";

/**
 * ONE BRANCH — the control surface of a business location: what it plays now (cover, position, volume, modes, what is next) and the
 * branch's own tools (its schedule on / off, jingles, pick something to play). Opening it makes this branch the one the whole app controls.
 */

export default function MobileBranchPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ""));
  const f = useMobileFleet();
  const tr = useTr();
  const branch = f.branches.find((b) => b.id === id) ?? null;

  // opening a branch makes it THE branch the whole app (mini-player, library, search) controls
  const { select } = f;
  useEffect(() => {
    if (branch) select(branch.id);
  }, [branch, select]);

  const back = (
    <Link href="/mobile/home" className="vm-icobtn vm-back" aria-label={tr("Branches")}>
      <IconChevronBack />
      <span>{tr("Branches")}</span>
    </Link>
  );

  if (f.loaded && !branch) {
    return (
      <VmPage title={tr("Branch")} lead={back}>
        <div className="vm-empty">
          <IconStore />
          <h2>{tr("This branch isn't available")}</h2>
          <span>{tr("It may have been removed, or you may not have access to it.")}</span>
        </div>
      </VmPage>
    );
  }

  return (
    <VmPage title={branch?.name ?? ""} barTitle={branch?.name} lead={back} subtitle={branch?.city || undefined}>
      <VmNowPlaying hideWho />

      <div className="vm-group">
        <VmScheduleSwitchLine branchId={branch?.id ?? null} />
        <Link href="/mobile/scheduling" className="vm-line">
          <IconUpNext />
          <span className="vm-line-text">{tr("Today's plan")}</span>
          <IconChevronForward className="vm-chev vm-flip" />
        </Link>
        <Link href="/mobile/jingles" className="vm-line">
          <IconJingle />
          <span className="vm-line-text">{tr("Jingles")}</span>
          <IconChevronForward className="vm-chev vm-flip" />
        </Link>
        <Link href="/mobile/library" className="vm-line">
          <IconLibrary />
          <span className="vm-line-text">{tr("Pick something to play")}</span>
          <IconChevronForward className="vm-chev vm-flip" />
        </Link>
      </div>
    </VmPage>
  );
}

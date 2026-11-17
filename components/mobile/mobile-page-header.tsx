"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useTr } from "@/lib/i18n/use-tr";
import { IconChevronBack } from "@/components/vm/vm-icons";

type Props = {
  title: string;
  /** Optional right-side actions (e.g. search icon, add icon). */
  actions?: ReactNode;
  /** kept for the older pages that still pass it — the phone is always a remote now, so there is no mode to show */
  showModePill?: boolean;
};

const TAB_ROOTS = new Set(["/mobile/home", "/mobile/library", "/mobile/search", "/mobile/account"]);

/** The header of the phone app's older sub-pages (Jingles, Scheduling, …): the same large title as the new screens, with a back button off the tab roots. */
export function MobilePageHeader({ title, actions }: Props) {
  const tr = useTr();
  const pathname = usePathname() ?? "";
  const isRoot = TAB_ROOTS.has(pathname);
  return (
    <div className="vm-head" data-lead={isRoot ? undefined : ""} style={{ position: "relative" }}>
      {!isRoot ? (
        <Link href="/mobile/home" className="vm-icobtn vm-back" aria-label={tr("Branches")} style={{ position: "absolute", top: "calc(4px + var(--vm-safe-t))", insetInlineStart: 4 }}>
          <IconChevronBack />
          <span>{tr("Branches")}</span>
        </Link>
      ) : null}
      <h1 className="vm-title vm-bdi">{tr(title)}</h1>
      {actions ? <div className="vm-head-end" style={{ display: "flex", alignItems: "center", gap: 6 }}>{actions}</div> : null}
    </div>
  );
}

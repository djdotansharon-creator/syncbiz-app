"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMobileFleet } from "@/lib/mobile-fleet";
import { useTr } from "@/lib/i18n/use-tr";
import { useBranchPeople, type BranchPerson } from "@/components/control-room/branch-people";
import { VmPage } from "@/components/vm/vm-ui";
import { VmCover } from "@/components/vm/vm-parts";
import { IconChevronBack, IconChevronForward, IconPeople, IconPerson } from "@/components/vm/vm-icons";
import { agoLabel } from "@/components/vm/vm-people-parts";

/**
 * THE PEOPLE OF ONE BRANCH (owner 2026-11-17: "the people under a branch"). The same rule and the same data as the computer's branch screen
 * (lib/branch-people.ts + /api/people + /api/admin/users): the members given this branch, and — apart — the owners and managers who reach every branch.
 * A row opens that person's own page (owner 2026-11-18: "a manager must be able to control these things from afar") where an administrator changes the role, the branches, pauses or removes
 * them — see app/(app)/mobile/people. Only a workspace administrator can read the list; for anyone else the screen says so. This screen itself writes nothing.
 */
export default function MobileBranchPeoplePage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ""));
  const f = useMobileFleet();
  const tr = useTr();
  const branch = f.branches.find((b) => b.id === id) ?? null;
  const d = useBranchPeople(id);

  const back = (
    <Link href={`/mobile/branch/${encodeURIComponent(id)}`} className="vm-icobtn vm-back" aria-label={branch?.name ?? tr("Branch")}>
      <IconChevronBack />
      <span>{branch?.name ?? tr("Branch")}</span>
    </Link>
  );

  const role = (p: BranchPerson) => p.roleName ?? tr(p.level === "owner" ? "Owner" : p.level === "manager" ? "Manager" : "Member");
  const line = (p: BranchPerson) => (
    <Link key={p.userId} href={`/mobile/people/${encodeURIComponent(p.userId)}`} className="vm-line" style={{ opacity: p.status === "active" ? 1 : 0.55 }}>
      <VmCover name={p.name || p.email} size={40} radius={999} />
      <span className="vm-line-text vm-bdi">
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {p.name}
          {p.isYou ? ` (${tr("You")})` : ""}
        </span>
        <small>
          {role(p)} · {p.status === "active" ? agoLabel(p.lastSignInAt, tr) : tr(p.status === "paused" ? "Paused" : "Disabled")}
        </small>
      </span>
      <IconChevronForward className="vm-chev vm-flip" />
    </Link>
  );

  return (
    <VmPage title={tr("People")} lead={back} subtitle={branch?.name}>
      {d.state === "loading" ? <p className="vm-sub" style={{ margin: "24px", textAlign: "center" }}>…</p> : null}
      {d.state === "hidden" ? (
        <div className="vm-empty">
          <IconPerson />
          <h2>{tr("People")}</h2>
          <span>{tr("Only an administrator can see the people of a branch.")}</span>
        </div>
      ) : null}
      {d.state === "ready" ? (
        <>
          <div className="vm-sec">
            {tr("On this branch")} <b>{d.assigned.length}</b>
          </div>
          {d.assigned.length === 0 ? (
            <p className="vm-sub" style={{ margin: "6px 24px 0" }}>{tr("No one is assigned to this branch yet.")}</p>
          ) : (
            <div className="vm-group" style={{ marginTop: 8 }}>{d.assigned.map(line)}</div>
          )}
          {d.everyBranch.length > 0 ? (
            <>
              <div className="vm-sec">
                {tr("See every branch")} <b>{d.everyBranch.length}</b>
              </div>
              <p className="vm-sub" style={{ margin: "0 24px 8px" }}>{tr("Owners and managers reach all the branches, this one too.")}</p>
              <div className="vm-group" style={{ marginTop: 0 }}>{d.everyBranch.map(line)}</div>
            </>
          ) : null}
          <div className="vm-group">
            <Link href="/mobile/people" className="vm-line">
              <IconPeople />
              <span className="vm-line-text">
                {tr("Everyone in the business")}
                <small>{tr("Add a person, answer requests, change roles")}</small>
              </span>
              <IconChevronForward className="vm-chev vm-flip" />
            </Link>
          </div>
        </>
      ) : null}
    </VmPage>
  );
}

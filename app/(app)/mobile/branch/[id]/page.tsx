"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { useMobileFleet } from "@/lib/mobile-fleet";
import { useTr } from "@/lib/i18n/use-tr";
import { VmPage } from "@/components/vm/vm-ui";
import { VmNowPlaying } from "@/components/vm/vm-now-playing";
import { useBranchPeople } from "@/components/control-room/branch-people";
import { useSongIdAvailable } from "@/lib/use-song-id-available";
import { VmScheduleSwitchLine } from "@/components/vm/vm-schedule-switch";
import { IconChevronBack, IconChevronForward, IconIdentify, IconJingle, IconLibrary, IconPeople, IconStore, IconUpNext } from "@/components/vm/vm-icons";

/**
 * ONE BRANCH — the control surface of a business location: what it plays now (cover, position, volume, modes, what is next) and the
 * branch's own tools, in three groups: its SCHEDULE (on / off, today's plan) · what it PLAYS (pick songs, identify a song / Shazam, jingles) · its PEOPLE (read only;
 * only for a workspace administrator). Opening it makes this branch the one the whole app controls.
 */

export default function MobileBranchPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ""));
  const f = useMobileFleet();
  const tr = useTr();
  const branch = f.branches.find((b) => b.id === id) ?? null;
  const people = useBranchPeople(id);
  const songId = useSongIdAvailable();

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
      </div>

      <div className="vm-group">
        <Link href="/mobile/library" className="vm-line">
          <IconLibrary />
          <span className="vm-line-text">
            {tr("Pick something to play")}
            <small>{tr("Playlists and your library")}</small>
          </span>
          <IconChevronForward className="vm-chev vm-flip" />
        </Link>
        {songId.any ? (
          <Link href="/mobile/identify" className="vm-line">
            <IconIdentify />
            <span className="vm-line-text">
              {tr("Identify a song")}
              <small>{tr("Listen to the room, or paste a Shazam link")}</small>
            </span>
            <IconChevronForward className="vm-chev vm-flip" />
          </Link>
        ) : null}
        <Link href="/mobile/jingles" className="vm-line">
          <IconJingle />
          <span className="vm-line-text">
            {tr("Jingles")}
            <small>{tr("Play a jingle on the speakers, or make a new one")}</small>
          </span>
          <IconChevronForward className="vm-chev vm-flip" />
        </Link>
      </div>

      {people.state === "ready" ? (
        <div className="vm-group">
          <Link href={`/mobile/branch/${encodeURIComponent(id)}/people`} className="vm-line">
            <IconPeople />
            <span className="vm-line-text">
              {tr("People")}
              <small>{tr("{n} on this branch", { n: people.assigned.length })}</small>
            </span>
            <IconChevronForward className="vm-chev vm-flip" />
          </Link>
        </div>
      ) : null}
    </VmPage>
  );
}

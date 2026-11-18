"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useMobileFleet } from "@/lib/mobile-fleet";
import { useTr } from "@/lib/i18n/use-tr";
import { VmPage, useVmUi } from "@/components/vm/vm-ui";
import { VmNowPlaying } from "@/components/vm/vm-now-playing";
import { useNowTone } from "@/components/vm/vm-tone";
import { VmCover } from "@/components/vm/vm-parts";
import { Rise, VmFlow, VmFlowSection, VmFold, VmKv } from "@/components/vm/vm-flow";
import { useBranchPeople } from "@/components/control-room/branch-people";
import { useSongIdAvailable } from "@/lib/use-song-id-available";
import { canRenameBranch, renameBranch, useBranchDetails } from "@/lib/use-branch-details";
import { VmScheduleSwitchLine } from "@/components/vm/vm-schedule-switch";
import { IconChevronBack, IconChevronForward, IconIdentify, IconJingle, IconLibrary, IconPencil, IconPeople, IconStore, IconUpNext } from "@/components/vm/vm-icons";

/**
 * ONE BRANCH — a flow (owner 2026-11-18, an experiment: "the background does not move, only the elements rise from below as I scroll down, a part at a time, like the iPhone's Control Center").
 * Part 1: what the branch plays now (cover, position, volume, modes, what is next). Part 2: what plays — pick songs, identify a song / Shazam, jingles — and its schedule. Part 3: its people
 * (only for an administrator) and the branch itself (address, number, time zone, player) behind an arrow, closed until it is pressed. The background is the colour of the song that plays.
 * Opening a branch makes it the one the whole app controls.
 */

function FlowLink({ href, icon, title, sub }: { href: string; icon: ReactNode; title: string; sub?: string }) {
  return (
    <Link href={href} className="vm-fl-row">
      {icon}
      <span className="vm-fl-text">
        {title}
        {sub ? <small>{sub}</small> : null}
      </span>
      <IconChevronForward className="vm-chev vm-flip" />
    </Link>
  );
}

/** the sheet that renames the branch: one field, one button (the owner's own route decides) */
function RenameBody({ initial, onSave, labels }: { initial: string; onSave: (name: string) => Promise<string | null>; labels: { title: string; save: string; hint: string } }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = name.trim();
  return (
    <div className="vm-ask">
      <h2 className="vm-bdi">{labels.title}</h2>
      <label className="vm-field" style={{ margin: "4px 0 0" }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label={labels.title} autoFocus />
      </label>
      <p>{labels.hint}</p>
      {error ? <p className="vm-err" style={{ margin: 0 }}>{error}</p> : null}
      <button
        type="button"
        className="vm-ask-btn"
        data-main=""
        disabled={busy || !clean || clean === initial.trim()}
        onClick={async () => {
          setBusy(true);
          setError(await onSave(clean));
          setBusy(false);
        }}
      >
        {labels.save}
      </button>
    </div>
  );
}

export default function MobileBranchPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ""));
  const f = useMobileFleet();
  const tr = useTr();
  const ui = useVmUi();
  const tone = useNowTone();
  const branch = f.branches.find((b) => b.id === id) ?? null;
  const people = useBranchPeople(id);
  const songId = useSongIdAvailable();
  const details = useBranchDetails(id);

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

  const facts = details.state === "ready" ? details.facts : null;
  const isOwner = details.state === "ready" && details.isOwner;
  const playerText = !branch ? "" : branch.status === "install" ? tr("Not installed yet") : branch.online ? tr("Connected") : tr("Offline");

  const openRename = () => {
    if (!facts?.number || details.state !== "ready") return;
    const number = facts.number;
    ui.openSheet(
      tr("Branch name"),
      <RenameBody
        initial={facts.name}
        labels={{ title: tr("Branch name"), save: tr("Save"), hint: tr("The branch number and the address stay as they are.") }}
        onSave={async (name) => {
          const r = await renameBranch(id, name, number);
          if (!r.ok) return tr(r.message === "Only the owner can manage branches." ? "Only the owner can change a branch." : "Something went wrong. Please try again.");
          ui.closeSheet();
          ui.toast(tr("Saved"));
          f.refresh();
          await details.reload();
          return null;
        }}
      />,
    );
  };

  return (
    <VmPage flow title={branch?.name ?? ""} barTitle={branch?.name} lead={back} subtitle={branch?.city || undefined}>
      <VmFlow tone={tone}>
        {/* 1 — what plays now */}
        <VmFlowSection label={tr("Now playing")}>
          <Rise enter={0}>
            <VmNowPlaying hideWho />
          </Rise>
        </VmFlowSection>

        {/* 2 — what plays, and when */}
        <VmFlowSection tall label={tr("What plays")}>
          <Rise>
            <h2 className="vm-fl-h">{tr("What plays")}</h2>
          </Rise>
          <div className="vm-fl-list">
            <Rise>
              <FlowLink href="/mobile/library" icon={<IconLibrary />} title={tr("Pick something to play")} sub={tr("Playlists and your library")} />
            </Rise>
            {songId.any ? (
              <Rise>
                <FlowLink href="/mobile/identify" icon={<IconIdentify />} title={tr("Identify a song")} sub={tr("Listen to the room, or paste a Shazam link")} />
              </Rise>
            ) : null}
            <Rise>
              <FlowLink href="/mobile/jingles" icon={<IconJingle />} title={tr("Jingles")} sub={tr("Play a jingle on the speakers, or make a new one")} />
            </Rise>
          </div>

          <Rise>
            <h2 className="vm-fl-h" style={{ marginTop: 30 }}>{tr("Schedule")}</h2>
          </Rise>
          <div className="vm-fl-list">
            <Rise>
              <VmScheduleSwitchLine branchId={branch?.id ?? null} />
            </Rise>
            <Rise>
              <FlowLink href="/mobile/scheduling" icon={<IconUpNext />} title={tr("Today's plan")} />
            </Rise>
          </div>
        </VmFlowSection>

        {/* 3 — who is here, and the branch itself */}
        <VmFlowSection tall label={tr("The branch")}>
          {people.state === "ready" ? (
            <>
              <Rise>
                <h2 className="vm-fl-h">{tr("People")}</h2>
              </Rise>
              {people.assigned.length > 0 ? (
                <Rise>
                  <div className="vm-avatars">
                    {people.assigned.slice(0, 6).map((p) => (
                      <VmCover key={p.userId} name={p.name || p.email} size={40} radius={999} />
                    ))}
                  </div>
                </Rise>
              ) : null}
              <div className="vm-fl-list">
                <Rise>
                  <FlowLink href={`/mobile/branch/${encodeURIComponent(id)}/people`} icon={<IconPeople />} title={tr("People")} sub={tr("{n} on this branch", { n: people.assigned.length })} />
                </Rise>
              </div>
            </>
          ) : null}

          <Rise>
            <h2 className="vm-fl-h" style={{ marginTop: 30 }}>{tr("The branch")}</h2>
          </Rise>
          <div className="vm-fl-list">
            <Rise>
              <VmFold label={tr("Details")} summary={facts?.address || facts?.city || undefined}>
                <VmKv label={tr("Name")} value={facts?.name || branch?.name || "—"} />
                {facts?.address ? <VmKv label={tr("Address")} value={facts.address} /> : null}
                {facts?.number ? <VmKv label={tr("Branch number")} value={facts.number} dir="ltr" /> : null}
                {facts?.timezone ? <VmKv label={tr("Time zone")} value={facts.timezone} dir="ltr" /> : null}
                <VmKv label={tr("Player")} value={playerText} />
                {facts?.stationVersion ? <VmKv label={tr("Version")} value={facts.stationVersion} dir="ltr" /> : null}
                {canRenameBranch(isOwner, facts) ? (
                  <button type="button" className="vm-fl-row" style={{ paddingInline: 0, marginTop: 6 }} onClick={openRename}>
                    <IconPencil />
                    <span className="vm-fl-text">{tr("Change the branch name")}</span>
                  </button>
                ) : null}
              </VmFold>
            </Rise>
          </div>
        </VmFlowSection>
      </VmFlow>
    </VmPage>
  );
}

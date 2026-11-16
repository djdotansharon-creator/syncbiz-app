"use client";

import Link from "next/link";
import { useMobileFleet } from "@/lib/mobile-fleet";
import { useTr } from "@/lib/i18n/use-tr";
import { useVmUi } from "@/components/vm/vm-ui";
import { VmCover, VmEq } from "@/components/vm/vm-parts";
import { IconPause, IconPlay, IconPlus } from "@/components/vm/vm-icons";
import type { UnifiedSource } from "@/lib/source-types";

/** What the phone shows for a library item: a playlist's cover (or its first song's), its length in songs, or a single song's provider. */
export function sourceCover(s: UnifiedSource): string | null {
  if (s.cover) return s.cover;
  const t = s.playlist?.tracks?.find((x) => x.cover);
  return t?.cover ?? null;
}

/**
 * A library row. Tapping the row OPENS it (a playlist's songs); sending music to a live store is always an explicit tap on its own button
 * (play now / play next), so a slip of the thumb never interrupts the music of a branch.
 */
export function VmSourceRow({ source, href }: { source: UnifiedSource; href?: string | null }) {
  const f = useMobileFleet();
  const tr = useTr();
  const ui = useVmUi();
  const shown = f.display.shown;
  const active = !!shown && shown.status === "playing" && (shown.currentSource?.id === source.id || shown.currentSource?.id?.startsWith(`${source.id}:`) === true);
  const isPlaylist = source.origin === "playlist";
  const count = isPlaylist ? source.playlist?.tracks?.length ?? 0 : 0;
  const sub = isPlaylist ? (count > 0 ? count === 1 ? tr("1 song") : tr("{n} songs", { n: count }) : tr("Empty playlist")) : source.genre && source.genre !== "Mixed" ? source.genre : tr("Song");

  const guard = (): boolean => {
    if (!f.selected) {
      ui.openPicker();
      return false;
    }
    if (!f.canControl) {
      ui.toast(tr("{name} is offline", { name: f.selected.name }));
      return false;
    }
    return true;
  };
  const playNow = () => {
    if (!guard()) return;
    if (active) {
      f.pause(); // the same button pauses what it is playing
      return;
    }
    f.playSource(source);
    ui.toast(tr("Playing on {name}", { name: f.selected!.name }));
  };
  const playNext = () => {
    if (!guard()) return;
    f.queueNext(source);
    ui.toast(tr("Will play next on {name}", { name: f.selected!.name }));
  };

  const body = (
    <>
      <VmCover src={sourceCover(source)} name={source.title} size={52} radius={12} />
      <span className="vm-src-text">
        <span className="vm-src-title vm-bdi" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {active ? <VmEq /> : null}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{source.title}</span>
        </span>
        <span className="vm-src-sub vm-bdi">{sub}</span>
      </span>
    </>
  );

  return (
    <div className="vm-src" data-active={active ? "" : undefined}>
      {href ? (
        <Link href={href} className="vm-src-main">
          {body}
        </Link>
      ) : (
        <div className="vm-src-main">{body}</div>
      )}
      <button type="button" className="vm-add" onClick={playNext} aria-label={tr("Play next")}>
        <IconPlus />
      </button>
      <button type="button" className="vm-add" onClick={playNow} aria-label={tr("Play now")} style={{ background: "var(--vm-text)", color: "#111114" }}>
        {active ? <IconPause /> : <IconPlay />}
      </button>
    </div>
  );
}

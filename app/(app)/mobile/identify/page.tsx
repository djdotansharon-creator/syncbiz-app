"use client";

import { MobileShazamImport } from "@/components/mobile/mobile-shazam-import";
import { MobileListenIdentify } from "@/components/mobile/mobile-listen-identify";
import { useTr } from "@/lib/i18n/use-tr";
import { useVmSongRoute } from "@/lib/use-vm-song-route";
import { useSongIdAvailable } from "@/lib/use-song-id-available";
import { VmPage, VmTarget } from "@/components/vm/vm-ui";
import { IconChevronBack, IconIdentify } from "@/components/vm/vm-icons";
import Link from "next/link";

/**
 * IDENTIFY A SONG — hear a song in the room (one tap on the mic) or paste a Shazam link; the song is looked up and lined up on the branch that is open.
 * The same two parts sit at the bottom of Search; this screen gives them a door of their own from the branch screen (owner 2026-11-17: "where is Shazam?").
 */
export default function MobileIdentifyPage() {
  const tr = useTr();
  const route = useVmSongRoute();
  const avail = useSongIdAvailable();
  const back = (
    <Link href="/mobile/search" className="vm-icobtn vm-back" aria-label={tr("Search")}>
      <IconChevronBack />
      <span>{tr("Search")}</span>
    </Link>
  );
  return (
    <VmPage title={tr("Identify a song")} lead={back}>
      <VmTarget />
      {avail.any === false ? (
        <div className="vm-empty">
          <IconIdentify />
          <h2>{tr("Song identification isn't switched on yet")}</h2>
          <span>{tr("It is turned on from the server settings. Until then you can still find a song with Search.")}</span>
        </div>
      ) : (
        <div style={{ padding: "12px 14px 0", display: "flex", flexDirection: "column", gap: 12 }}>
          <MobileListenIdentify route={route} />
          <MobileShazamImport variant="hero" route={route} />
        </div>
      )}
    </VmPage>
  );
}

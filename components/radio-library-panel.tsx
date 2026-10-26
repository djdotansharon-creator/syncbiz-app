"use client";

/**
 * RadioLibraryPanel — the "Radio" heading of the library (owner 2026-10-23): one more word in the chip row next to
 * Playlists / Recently Added, and under it every station as a SQUARE — your stations first (with a "+" square to add one),
 * then "Israeli stations". The playing station's square shows LIVE and the song it is broadcasting.
 * Same play rules as the library cards: a controller sends the command to the station (`playSourceOrSend`), a player plays here.
 * Styles: `.sb-rad*` in globals.css — flat, translucent surfaces only (no blur layers), on purpose.
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { useDevicePlayer } from "@/lib/device-player-context";
import { radioToUnified } from "@/lib/radio-utils";
import { getRadioStationsLocal, removeRadioStationLocal } from "@/lib/radio-local-store";
import { useRadioNowPlaying } from "@/lib/use-radio-now-playing";
import { radioToShareable } from "@/lib/share-utils";
import { RadioSearchBar } from "@/components/radio-search-bar";
import { RadioPresetsSection } from "@/components/radio-presets-section";
import { RadioArt } from "@/components/radio-art";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { ShareModal } from "@/components/share-modal";
import type { RadioStream } from "@/lib/source-types";

const HE = { mine: "התחנות שלי", add: "הוסיפו תחנה", empty: "עוד אין תחנות — חפשו תחנה למעלה או הוסיפו מהתחנות הישראליות", live: "שידור חי", play: "נגן", pause: "השהה", share: "שיתוף", edit: "עריכה", del: "מחיקה", delConfirm: "למחוק את התחנה?" };
const EN = { mine: "My stations", add: "Add a station", empty: "No stations yet — search above or add one of the Israeli stations", live: "LIVE", play: "Play", pause: "Pause", share: "Share", edit: "Edit", del: "Delete", delConfirm: "Delete this station?" };

function mergeStations(server: RadioStream[], local: RadioStream[]): RadioStream[] {
  const byId = new Map<string, RadioStream>();
  for (const s of server) byId.set(s.id, s);
  for (const s of local) if (!byId.has(s.id)) byId.set(s.id, s);
  return [...byId.values()];
}

/** The server's stations merged with this browser's local list (a station saved only here still shows). */
async function fetchStations(): Promise<RadioStream[]> {
  let server: RadioStream[] = [];
  try {
    const res = await fetch("/api/radio", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as unknown;
      if (Array.isArray(data)) server = data as RadioStream[];
    }
  } catch {
    /* offline: the local list below still shows */
  }
  return mergeStations(server, getRadioStationsLocal());
}

const Glyph = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

export function RadioLibraryPanel(): ReactElement {
  const { locale } = useLocale();
  const he = locale === "he";
  const t = he ? HE : EN;
  const playback = usePlayback();
  const deviceCtx = useDevicePlayer();
  const [stations, setStations] = useState<RadioStream[]>([]);
  const [loaded, setLoaded] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Same routing rule as the library cards: a controller (connected, not the MASTER itself) talks to the station.
  const controller = !!deviceCtx?.isBranchConnected && deviceCtx.deviceMode !== "MASTER";
  const current = controller ? deviceCtx?.masterState?.currentSource : playback.currentSource;
  const status = controller ? deviceCtx?.masterState?.status : playback.status;

  const reload = useCallback(() => {
    void fetchStations().then(setStations);
  }, []);

  useEffect(() => {
    let off = false;
    void fetchStations().then((list) => {
      if (off) return;
      setStations(list);
      setLoaded(true);
    });
    return () => {
      off = true;
    };
  }, []);

  const play = useCallback(
    (st: RadioStream) => {
      const unified = radioToUnified(st);
      if (controller) {
        deviceCtx?.playSourceOrSend(unified);
        return;
      }
      playback.setQueue(stations.map(radioToUnified)); // next / previous move between stations
      playback.playSource(unified);
    },
    [controller, deviceCtx, playback, stations],
  );
  const pause = useCallback(() => {
    if (controller) deviceCtx?.pauseOrSend();
    else playback.pause();
  }, [controller, deviceCtx, playback]);

  const focusSearch = useCallback(() => {
    searchRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    searchRef.current?.querySelector("input")?.focus({ preventScroll: true });
  }, []);

  const removeLocal = useCallback((id: string) => {
    setStations((prev) => prev.filter((s) => s.id !== id));
    removeRadioStationLocal(id);
  }, []);

  return (
    <div dir={he ? "rtl" : "ltr"} className="sb-rad">
      <div ref={searchRef} className="sb-rad-search">
        <RadioSearchBar onAdd={reload} />
      </div>

      <section aria-labelledby="sb-rad-mine">
        <h2 id="sb-rad-mine" className="sb-rad-title">{t.mine}</h2>
        {loaded && stations.length === 0 ? <p className="sb-rad-empty">{t.empty}</p> : null}
        <div className="sb-rad-grid">
          {stations.map((st) => (
            <StationTile
              key={st.id}
              station={st}
              active={current?.id === st.id}
              playing={current?.id === st.id && status === "playing"}
              onPlay={play}
              onPause={pause}
              onRemoved={removeLocal}
              t={t}
            />
          ))}
          <button type="button" className="sb-rad-add" onClick={focusSearch}>
            <span className="sb-rad-add-sq">
              <Glyph d="M12 5v14M5 12h14" size={30} />
            </span>
            <span className="sb-rad-name">{t.add}</span>
          </button>
        </div>
      </section>

      <RadioPresetsSection stations={stations} onAdded={reload} />
    </div>
  );
}

function StationTile({
  station,
  active,
  playing,
  onPlay,
  onPause,
  onRemoved,
  t,
}: {
  station: RadioStream;
  active: boolean;
  playing: boolean;
  onPlay: (s: RadioStream) => void;
  onPause: () => void;
  onRemoved: (id: string) => void;
  t: typeof EN;
}): ReactElement {
  const song = useRadioNowPlaying(active ? station.id : null, playing);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/radio/${station.id}`, { method: "DELETE" });
      // 404 = a station that lives only in this browser's local list (or is already gone) — drop it locally too.
      if (res.ok || res.status === 404) onRemoved(station.id);
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  return (
    <article className="sb-rad-tile" data-active={active ? "1" : undefined} data-playing={playing ? "1" : undefined}>
      <div className="sb-rad-art">
        <RadioArt cover={station.cover} />
        {active ? <span className="sb-rad-live">{t.live}</span> : null}
        <button
          type="button"
          className="sb-rad-hit"
          onClick={() => (playing ? onPause() : onPlay(station))}
          aria-label={`${playing ? t.pause : t.play} ${station.name}`}
        >
          <span className="sb-rad-glyph">
            {playing ? (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden style={{ marginInlineStart: 2 }}>
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </span>
        </button>
        <span className="sb-rad-acts">
          <button type="button" onClick={() => setShareOpen(true)} title={t.share} aria-label={t.share}>
            <Glyph d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" size={15} />
          </button>
          <Link href={`/radio/${station.id}/edit`} title={t.edit} aria-label={t.edit}>
            <Glyph d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" size={15} />
          </Link>
          <button type="button" onClick={() => setDeleteOpen(true)} disabled={deleting} title={t.del} aria-label={t.del} data-danger="1">
            <Glyph d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" size={15} />
          </button>
        </span>
      </div>
      <p className="sb-rad-name" dir="auto" title={station.name}>{station.name}</p>
      <p className="sb-rad-sub" dir="auto" title={song ?? station.genre ?? ""}>{song ? `♪ ${song}` : station.genre || ""}</p>
      {shareOpen ? <ShareModal item={radioToShareable(station)} fallbackRadioId={station.id} onClose={() => setShareOpen(false)} /> : null}
      <DeleteConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} loading={deleting} message={t.delConfirm} />
    </article>
  );
}

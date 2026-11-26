"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRemoteOwner, type ConnectionStatus } from "@/lib/remote-control/ws-client";
import type { BranchSummary, StationPlaybackState } from "@/lib/remote-control/types";
import { unifiedSourceToPayload } from "@/lib/remote-control/source-to-payload";
import type { UnifiedSource } from "@/lib/source-types";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { warmTone } from "@/lib/cover-tone";
import { followingOf, pickIncoming, withIncoming, type TappedIncoming } from "@/lib/mobile-incoming";
import { appendJingleToken } from "@/lib/jingles/jingle-session";
import {
  beginTransition,
  decideUserCommand,
  displayPlaybackState,
  failTransition,
  holdsAudible,
  isBlocking,
  observeTransition,
  targetKeyOf,
  tickTransition,
  transitionLabel,
  type UrlTransition,
} from "@/lib/url-transition-intent";

/**
 * THE PHONE APP'S BRANCH LAYER (owner 2026-11-16: "the phone is a remote for the businesses — connect to the branches from afar, see what plays in
 * each, control everything; no local player for now").
 *
 * ONE live connection (the same owner_global socket the Control Room uses, `useRemoteOwner`) gives every branch the signed-in person may see and the
 * last state of each branch's station. The phone picks ONE branch at a time ("selected") and every transport / library action goes to THAT branch's
 * station only — `sendCommandTo(<raw branch id>, …)`. Nothing here plays audio on the phone, registers as a player, or touches a MASTER designation
 * (CLAUDE.md §11: phone = CONTROL only). The branch list = the database's branches (`GET /api/branches`) joined with the live list, exactly as the
 * Control Room does (join on the canonical branch id; a station may register with a legacy alias).
 *
 * The "one pending source transition" rules (lib/url-transition-intent.ts — P0 Gate 1c/1d/1f) are the SAME pure functions the old controller layer
 * (StationControllerProvider) uses, applied to the selected branch: a second NEXT while one is loading is ignored, a selection keeps showing the audible
 * song until the new one is ready, and "Loading…" / "Couldn't play" come from the shared intent.
 */

export type FleetStatus = "playing" | "idle" | "offline" | "install" | "unknown";

export type FleetBranch = {
  /** canonical branch id (the database id) — the stable key everywhere in the phone UI */
  id: string;
  /** the id the socket routes commands by (the station's registration id; may be a legacy alias) — null while the branch has no live station */
  rawId: string | null;
  name: string;
  city: string;
  logoUrl: string | null;
  hasStation: boolean;
  online: boolean;
  status: FleetStatus;
  state: StationPlaybackState | null;
  live: BranchSummary | null;
};

type DbBranch = {
  id: string;
  name?: string;
  code?: string;
  city?: string;
  hasStation?: boolean;
  logoUrl?: string | null;
};

export type FleetDisplay = {
  /** what to present as "now playing" (the audible item stays shown while a new one loads) */
  shown: StationPlaybackState | null;
  /** true until the station reports the new item ready */
  loading: boolean;
  /** "Loading…" / "Couldn't play — trying next…" … (null = nothing to say) */
  label: string | null;
};

export type FleetValue = {
  connection: ConnectionStatus;
  /** the live list has been heard (now, or a moment ago while it was coming back) — or we waited long enough (6 s) to call it: before that a branch that is "not live" is NOT yet "away" (no "offline" / "no player installed" flash while the phone connects) */
  known: boolean;
  /** the live connection dropped a moment ago and is coming back: the last-seen branches and states are still drawn (a picture, nothing is sent from it) — so a short drop does not blank the screen */
  holding: boolean;
  /** the branch list has been read from the database at least once */
  loaded: boolean;
  loadError: boolean;
  branches: FleetBranch[];
  selected: FleetBranch | null;
  select: (id: string) => void;
  /** ask the server for the connected-station list again (a station that dropped then shows Offline) */
  refresh: () => void;
  display: FleetDisplay;
  /** commands for the SELECTED branch — false when nothing was sent (no station online / socket down) */
  canControl: boolean;
  play: () => void;
  pause: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  playSource: (source: UnifiedSource) => void;
  queueNext: (source: UnifiedSource) => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  setShuffle: (value: boolean) => void;
  setAutoMix: (value: boolean) => void;
  setRepeat: (mode: "playlist" | "track" | "off") => void;
  /** a jingle / announcement over the music of the open branch (PLAY_INTERRUPT: the station ducks the music, plays it once, restores) — false when it could not be sent */
  interrupt: (url: string) => boolean;
  /** play / pause one branch from the list without opening it */
  toggleBranch: (id: string) => void;
};

const FleetContext = createContext<FleetValue | null>(null);

type SendTo = ReturnType<typeof useRemoteOwner>["sendCommandTo"];

const STORAGE_KEY = "vono-mobile-branch";
/**
 * INSTANT OPEN (owner 2026-11-19: "it does not come up at once, it is slow"). The first screen needs the branch list (a request) and the branch's state (a socket: token → connect → list → state), a second or
 * three on a phone. So what was last seen is remembered on the phone — the branch list, and the last state of each branch (what it played, its cover and colours, volume and modes) — and drawn at once;
 * the live answer replaces it as it arrives. A remembered state is only a picture: `canControl` stays false until the branch is really connected, and nothing is ever sent from it.
 */
const DB_CACHE_KEY = "vono-mobile-db-v1";
const STATE_CACHE_KEY = "vono-mobile-state-v1:";
function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* no room / blocked: the memory is only a help */
  }
}
/** the part of a station's state worth remembering: what it plays, how it looks, how it is set (never the whole queue) */
function slimState(s: StationPlaybackState): StationPlaybackState {
  return {
    status: s.status,
    currentTrack: s.currentTrack ?? null,
    currentSource: s.currentSource ?? null,
    currentTrackIndex: s.currentTrackIndex,
    sessionTitle: s.sessionTitle ?? null,
    sessionTracks: (s.sessionTracks ?? []).slice(0, 10),
    nextSessionTrack: s.nextSessionTrack,
    playNextQueue: (s.playNextQueue ?? []).slice(0, 5),
    duration: s.duration,
    position: s.position,
    positionAt: s.positionAt,
    volume: s.volume,
    shuffle: s.shuffle,
    autoMix: s.autoMix,
    repeatMode: s.repeatMode,
  } as StationPlaybackState;
}
/** the connected-station list is only sent on request — ask again so a station that drops shows Offline (same cadence as the Control Room) */
const LIVE_REFRESH_MS = 10_000;
/** how long the last-seen branches stay drawn after the live connection drops (owner 2026-11-19: "when I connect again there is a disconnect until it connects") — a long outage then shows the truth */
const HOLD_MS = 10_000;

function statusOf(online: boolean, hasStation: boolean, liveKnown: boolean, state: StationPlaybackState | null): FleetStatus {
  if (!online && !hasStation) return "install";
  if (!liveKnown) return "unknown";
  if (!online) return "offline";
  return state?.status === "playing" ? "playing" : "idle";
}

const RANK: Record<FleetStatus, number> = { playing: 0, idle: 1, unknown: 2, offline: 3, install: 4 };

export function MobileFleetProvider({ children }: { children: ReactNode }) {
  const owner = useRemoteOwner();
  const ownerRef = useRef(owner);
  useEffect(() => {
    ownerRef.current = owner; // the commands below read the newest socket at the moment they run
  });

  const [db, setDb] = useState<DbBranch[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  // the branch this phone used last is read at once (not in an effect a frame later: that frame said "No branch selected")
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return typeof window === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });
  // the remembered picture (read after mount: the server renders without the phone's storage)
  useEffect(() => {
    const cached = readJson<DbBranch[]>(DB_CACHE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the phone's remembered branch list, once on mount
    if (Array.isArray(cached) && cached.length) setDb((cur) => cur ?? cached.filter((b) => b && typeof b.id === "string"));
  }, []);

  // the branch list from the database (names, city, logo, whether a station exists)
  useEffect(() => {
    let off = false;
    const load = () =>
      fetch("/api/branches", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((rows: unknown) => {
          if (off) return;
          const list = Array.isArray(rows) ? (rows as DbBranch[]).filter((b) => b && typeof b.id === "string") : [];
          setDb(list);
          setLoadError(false);
          writeJson(DB_CACHE_KEY, list);
        })
        .catch(() => {
          if (!off) setLoadError(true);
        });
    void load();
    // a phone that was in the pocket comes back: read the list again (a new branch, a new station)
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      off = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // keep the live list fresh while the socket is up, and ask at once when the app comes back to the front
  useEffect(() => {
    if (owner.status !== "connected") return;
    const ask = () => ownerRef.current.refreshBranchList();
    const id = setInterval(ask, LIVE_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") ask();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [owner.status]);

  // the live connection dropped a moment ago: what it showed stays drawn for HOLD_MS (the timer runs from the first drop, not from every failed try)
  const held = owner.held;
  const [holdOver, setHoldOver] = useState<number | null>(null);
  useEffect(() => {
    if (!held) return;
    const t = setTimeout(() => setHoldOver(held.at), Math.max(0, HOLD_MS - (Date.now() - held.at)));
    return () => clearTimeout(t);
  }, [held]);
  const holding = !!held && owner.status !== "connected" && holdOver !== held.at;
  const liveBranches = holding && held ? held.branches : owner.branches;
  const liveStates = holding && held ? held.states : owner.remoteStateByDeviceId;
  // "known" = the live list has been HEARD (registered is a moment earlier — the list is what says which branches are live), or it was a moment ago and is coming back
  const liveKnown = (owner.status === "connected" && owner.listed) || holding;

  const branches: FleetBranch[] = useMemo(() => {
    const liveById = new Map(liveBranches.map((b) => [b.canonicalBranchId || b.branchId, b] as const));
    const out: FleetBranch[] = (db ?? []).map((b) => {
      const live = liveById.get(b.id) ?? null;
      liveById.delete(b.id);
      const state = live ? liveStates[live.masterDeviceId] ?? null : null;
      const hasStation = b.hasStation !== false;
      return {
        id: b.id,
        rawId: live?.branchId ?? null,
        name: b.name || b.code || "Branch",
        city: b.city ?? "",
        logoUrl: typeof b.logoUrl === "string" ? b.logoUrl : null,
        hasStation,
        online: !!live,
        status: statusOf(!!live, hasStation, liveKnown, state),
        state,
        live,
      };
    });
    // a connected station whose branch is not in the list (legacy id) — still shown, never hidden
    for (const live of liveById.values()) {
      const state = liveStates[live.masterDeviceId] ?? null;
      out.push({
        id: live.canonicalBranchId || live.branchId,
        rawId: live.branchId,
        name: live.branchName ?? "Connected station",
        city: "",
        logoUrl: null,
        hasStation: true,
        online: true,
        status: statusOf(true, true, liveKnown, state),
        state,
        live,
      });
    }
    return out.sort((a, b) => RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name));
  }, [db, liveBranches, liveStates, liveKnown]);

  // the chosen branch: the last one used on this phone, else the one playing, else the first online, else the first.
  // An AUTOMATIC choice waits for the live list (else the first launch would lock onto an offline branch before the player's state arrives) and
  // follows the live branch while it is still automatic; a branch the person picked (or the one saved from last time) is never replaced.
  const autoPicked = useRef(false);
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGaveUp(true), 6000); // no live list within 6 s → choose from what the database says
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring the saved choice once, on mount
      if (saved) setSelectedId(saved);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    if (!branches.length) return;
    const best = () => branches.find((b) => b.status === "playing") ?? branches.find((b) => b.online) ?? null;
    const cur = selectedId ? branches.find((b) => b.id === selectedId) ?? null : null;
    if (!cur) {
      if (!liveKnown && !gaveUp) return;
      autoPicked.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the automatic choice follows the live list (an external system)
      setSelectedId((best() ?? branches[0]!).id);
      return;
    }
    if (autoPicked.current && !cur.online) {
      const b = best();
      if (b) setSelectedId(b.id); // an automatic choice follows the live branch
    }
  }, [branches, selectedId, liveKnown, gaveUp]);

  const selected = useMemo(() => branches.find((b) => b.id === selectedId) ?? null, [branches, selectedId]);
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  });

  // ── ONE pending source transition for the selected branch (same pure rules as the old controller layer) ──
  const [transition, setTransitionState] = useState<UrlTransition | null>(null);
  const transitionRef = useRef<UrlTransition | null>(null);
  const [heldState, setHeldState] = useState<StationPlaybackState | null>(null);
  const setTransition = useCallback((t: UrlTransition | null) => {
    if (t === transitionRef.current) return;
    transitionRef.current = t;
    setTransitionState(t);
    if (!holdsAudible(t)) setHeldState(null);
  }, []);
  // the item that was pressed (or the one a Next/Prev goes to), kept with the transition it belongs to — drawn at once while the station is still starting it (lib/mobile-incoming.ts)
  const [tapped, setTapped] = useState<TappedIncoming | null>(null);
  const liveState = selected?.state ?? null;
  const liveStateRef = useRef<StationPlaybackState | null>(liveState);
  useEffect(() => {
    liveStateRef.current = liveState;
  });
  const captureHeld = useCallback(() => {
    if (holdsAudible(transitionRef.current)) return;
    const rs = liveStateRef.current;
    setHeldState(rs?.status === "playing" ? rs : null);
  }, []);

  // another branch chosen → the old branch's pending intent means nothing here
  const lastSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- another branch chosen: the old branch's pending intent means nothing here
    if (lastSelectedRef.current !== null && lastSelectedRef.current !== selectedId) setTransition(null);
    lastSelectedRef.current = selectedId;
  }, [selectedId, setTransition]);

  useEffect(() => {
    const cur = transitionRef.current;
    if (!cur) return;
    const res = observeTransition(cur, {
      mode: "remote",
      attemptId: typeof liveState?.mpvAttemptId === "number" ? liveState.mpvAttemptId : null,
      pending: typeof liveState?.mpvAttemptPending === "boolean" ? liveState.mpvAttemptPending : null,
      sourceId: liveState?.currentSource?.id ?? null,
      trackIndex: typeof liveState?.currentTrackIndex === "number" ? liveState.currentTrackIndex : null,
      status: liveState?.status ?? "idle",
      position: typeof liveState?.position === "number" ? liveState.position : 0,
      error: liveState?.mpvEngineError ?? null,
      engineReady: liveState?.mpvEngineReady !== false,
    });
    /* eslint-disable react-hooks/set-state-in-effect -- folding the station's STATE_UPDATE into the one pending intent (same as the old controller layer); setTransition is a no-op when nothing changed */
    if (res.event === "confirmed") setTransition(null);
    else if (res.event === "failed" && res.t) setTransition(failTransition(res.t, Date.now()));
    else setTransition(res.t);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [liveState, setTransition]);
  useEffect(() => {
    if (!transition) return;
    const id = setInterval(() => setTransition(tickTransition(transitionRef.current, Date.now(), false)), 1000);
    return () => clearInterval(id);
  }, [transition, setTransition]);

  /** the raw id of the selected branch's station — null when it cannot take a command (no live station) */
  const target = useCallback((): string | null => {
    const s = selectedRef.current;
    return s && s.online && s.rawId ? s.rawId : null;
  }, []);
  const send = useCallback(
    (command: Parameters<SendTo>[1], payload?: Parameters<SendTo>[2]) => {
      const t = target();
      if (!t) return false;
      return ownerRef.current.sendCommandTo(t, command, payload);
    },
    [target],
  );

  const play = useCallback(() => {
    if (decideUserCommand(transitionRef.current, { kind: "play" }) !== "accept") return;
    send("PLAY");
  }, [send]);
  const pause = useCallback(() => {
    setTransition(null); // always allowed
    send("PAUSE");
  }, [send, setTransition]);
  const stop = useCallback(() => {
    setTransition(null); // always allowed
    send("STOP");
  }, [send, setTransition]);

  const beginNav = useCallback(
    (origin: "next" | "prev") => {
      const prior = liveStateRef.current?.mpvAttemptId;
      if (typeof prior !== "number") return; // an older station engine (no mirrored attempt id) → no "Loading…" rather than a stuck one
      captureHeld();
      const t = beginTransition({ origin, targetKey: null, now: Date.now(), priorAttemptId: prior, audibleAtStart: liveStateRef.current?.status === "playing" });
      const go = followingOf(liveStateRef.current, origin === "next" ? 1 : -1);
      setTapped(go ? { ...go, at: t.startedAt } : null);
      setTransition(t);
    },
    [captureHeld, setTransition],
  );
  const next = useCallback(() => {
    if (isBlocking(transitionRef.current)) return; // one navigation intent
    if (!target()) return;
    beginNav("next");
    send("NEXT");
  }, [beginNav, send, target]);
  const prev = useCallback(() => {
    if (isBlocking(transitionRef.current)) return;
    if (!target()) return;
    beginNav("prev");
    send("PREV");
  }, [beginNav, send, target]);

  const playSource = useCallback(
    (source: UnifiedSource) => {
      if (!target()) return;
      const key = targetKeyOf(source?.id, 0); // this path sends no trackIndex → the station mirrors index 0
      if (decideUserCommand(transitionRef.current, { kind: "select", targetKey: key }) !== "accept") return;
      const prior = liveStateRef.current?.mpvAttemptId;
      captureHeld();
      const t = beginTransition({
        origin: "select",
        targetKey: key,
        now: Date.now(),
        priorAttemptId: typeof prior === "number" ? prior : null,
        audibleAtStart: liveStateRef.current?.status === "playing",
      });
      transitionRef.current = t;
      setTransitionState(t);
      const oneSong = source.origin !== "playlist" || (source.playlist ? getPlaylistTracks(source.playlist).length === 1 : false);
      const pic = source.cover ?? (source.playlist ? getPlaylistTracks(source.playlist)[0]?.cover ?? null : null);
      setTapped(oneSong && source.title ? { title: source.title, cover: pic, at: t.startedAt } : null);
      warmTone(pic); // the song's colour is read while the station starts it — ready when the song appears
      send("PLAY_SOURCE", { source: unifiedSourceToPayload(source) });
    },
    [captureHeld, send, target],
  );
  const queueNext = useCallback((source: UnifiedSource) => { send("QUEUE_NEXT", { source: unifiedSourceToPayload(source) }); }, [send]);
  const seek = useCallback((seconds: number) => { if (Number.isFinite(seconds)) send("SEEK", { position: seconds }); }, [send]);
  const setVolume = useCallback((volume: number) => { if (Number.isFinite(volume)) send("SET_VOLUME", { volume: Math.max(0, Math.min(100, volume)) }); }, [send]);
  // absolute values, never a flip: the shown state comes only from the station's echo, so a double tap cannot desync
  const setShuffle = useCallback((value: boolean) => { send("SET_SHUFFLE", { value }); }, [send]);
  const setAutoMix = useCallback((value: boolean) => { send("SET_AUTOMIX", { value }); }, [send]);
  const setRepeat = useCallback((mode: "playlist" | "track" | "off") => { send("SET_REPEAT_MODE", { mode }); }, [send]);
  // F3: a phone pad fires a jingle the BRANCH MPV then fetches, so the url carries the workspace-scoped
  // jingle token. One boundary, so every current and future caller of interrupt() is covered.
  const interrupt = useCallback((url: string) => (url.trim() ? send("PLAY_INTERRUPT", { url: appendJingleToken(url) }) : false), [send]);

  const branchesRef = useRef(branches);
  useEffect(() => {
    branchesRef.current = branches;
  });
  const toggleBranch = useCallback((id: string) => {
    const b = branchesRef.current.find((x) => x.id === id);
    if (!b || !b.online || !b.rawId) return;
    ownerRef.current.sendCommandTo(b.rawId, b.state?.status === "playing" ? "PAUSE" : "PLAY");
  }, []);

  const select = useCallback((id: string) => {
    autoPicked.current = false; // the person chose it
    setSelectedId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  // the selected branch's last known state: remembered when it changes (not every second), drawn until the live one arrives
  const [rememberedState, setRememberedState] = useState<{ id: string; state: StationPlaybackState } | null>(null);
  useEffect(() => {
    if (!selectedId) return;
    const cached = readJson<StationPlaybackState>(STATE_CACHE_KEY + selectedId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the remembered state of the chosen branch, read when it is chosen
    setRememberedState(cached ? { id: selectedId, state: cached } : null);
  }, [selectedId]);
  const liveSig = liveState ? `${liveState.status}|${liveState.currentSource?.id ?? ""}|${liveState.currentTrack?.title ?? ""}|${liveState.currentTrackIndex}|${liveState.volume ?? ""}|${liveState.shuffle ? 1 : 0}${liveState.autoMix ? 1 : 0}|${liveState.repeatMode ?? ""}` : "";
  useEffect(() => {
    if (!selectedId || !liveStateRef.current) return;
    writeJson(STATE_CACHE_KEY + selectedId, slimState(liveStateRef.current));
  }, [selectedId, liveSig]);

  const display: FleetDisplay = useMemo(() => {
    const live = displayPlaybackState(liveState, holdsAudible(transition) ? heldState : null, transition);
    // nothing live yet: the remembered state of this branch is drawn (a picture, never a command source — `canControl` is still false until the branch is connected)
    // (drawn as paused, without a running clock: it is a picture of how the branch was, not a claim about now)
    const rs = !live.shown && !liveState && rememberedState && rememberedState.id === selectedId ? rememberedState.state : null;
    const remembered = rs ? ({ ...rs, status: rs.status === "playing" ? "paused" : rs.status, positionAt: undefined } as StationPlaybackState) : null;
    // the song being started is drawn at once (title, picture, colours) while the old one is still audible — "Loading…" says so; it ends by itself when the station plays it or fails
    const incoming = pickIncoming({ transition, tapped, live: liveState, held: holdsAudible(transition) ? heldState : null });
    const base = live.shown ?? remembered;
    return { shown: incoming ? withIncoming(base, incoming) : base, loading: live.loading, label: transitionLabel(transition) };
  }, [liveState, heldState, transition, tapped, rememberedState, selectedId]);

  const value: FleetValue = useMemo(
    () => ({
      connection: owner.status,
      known: liveKnown || gaveUp,
      holding,
      loaded: db !== null,
      loadError,
      branches,
      selected,
      select,
      refresh: () => ownerRef.current.refreshBranchList(),
      display,
      canControl: !!selected?.online && owner.status === "connected",
      play,
      pause,
      stop,
      next,
      prev,
      playSource,
      queueNext,
      seek,
      setVolume,
      setShuffle,
      setAutoMix,
      setRepeat,
      interrupt,
      toggleBranch,
    }),
    [owner.status, liveKnown, gaveUp, holding, db, loadError, branches, selected, select, display, play, pause, stop, next, prev, playSource, queueNext, seek, setVolume, setShuffle, setAutoMix, setRepeat, interrupt, toggleBranch],
  );

  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}

export function useMobileFleet(): FleetValue {
  const ctx = useContext(FleetContext);
  if (!ctx) throw new Error("useMobileFleet must be used inside <MobileFleetProvider>");
  return ctx;
}

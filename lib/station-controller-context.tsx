"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { useRemoteController } from "@/lib/remote-control/ws-client";
import type { StationPlaybackState, DeviceInfo, GuestRecommendationPayload } from "@/lib/remote-control/types";
import { GuestRecommendationModal } from "@/components/guest-recommendation-modal";
import type { UnifiedSource } from "@/lib/source-types";
import { unifiedSourceToPayload } from "@/lib/remote-control/source-to-payload";
import {
  beginTransition, decideUserCommand, failTransition, holdsAudible, isBlocking, observeTransition, targetKeyOf, tickTransition,
  type UrlTransition,
} from "@/lib/url-transition-intent";

type StationControllerContextValue = {
  /** Whether we have a remote player and are controlling it (cross-device mode). */
  isCrossDevice: boolean;
  /** Selected device ID for commands. */
  selectedDeviceId: string | null;
  setSelectedDeviceId: (id: string | null) => void;
  /** Remote playback state for the selected device. */
  remoteState: StationPlaybackState | null;
  /** P0 Gate 1c: the ONE pending source transition started from this controller (same rules as DevicePlayerContext). */
  transition: UrlTransition | null;
  /** P0 Gate 1f: the station state that was AUDIBLE when the transition began (shown as now playing while it holds). */
  transitionHeldState: StationPlaybackState | null;
  /** WS connection status. */
  status: "connecting" | "connected" | "disconnected" | "error";
  /** Available player devices. */
  devices: DeviceInfo[];
  /** Send command to the selected device. */
  sendPlay: () => void;
  sendPause: () => void;
  sendStop: () => void;
  sendNext: () => void;
  sendPrev: () => void;
  sendPlaySource: (source: UnifiedSource) => void;
  /** Add a song to the MASTER's Play-Next queue (existing QUEUE_NEXT command). */
  sendQueueNext: (source: UnifiedSource) => void;
  sendSeek: (seconds: number) => void;
  sendSetVolume: (volume: number) => void;
  /** Toggle MASTER shuffle. Sends the absolute desired value (existing SET_SHUFFLE command). */
  sendSetShuffle: (value: boolean) => void;
  /** Toggle MASTER AutoMix/crossfade. Sends the absolute desired value (existing SET_AUTOMIX command). */
  sendSetAutoMix: (value: boolean) => void;
  /** Set MASTER loop mode (playlist / track / off). Sends the absolute desired mode (SET_REPEAT_MODE). */
  sendSetRepeatMode: (mode: "playlist" | "track" | "off") => void;
};

const StationControllerContext = createContext<StationControllerContextValue | null>(null);

export function StationControllerProvider({ children }: { children: ReactNode }) {
  const [pendingGuestRecommendation, setPendingGuestRecommendation] = useState<GuestRecommendationPayload | null>(null);
  const onGuestRecommendation = useCallback((rec: GuestRecommendationPayload) => setPendingGuestRecommendation(rec), []);

  const {
    devices,
    masterDeviceId,
    status,
    sendCommand,
    remoteState: allRemoteState,
    sendApproveGuestRecommend,
    sendRejectGuestRecommend,
  } = useRemoteController({
    onGuestRecommendation,
  });

  // C: Always target current MASTER. No stale playback target references.
  const remoteState = masterDeviceId ? allRemoteState[masterDeviceId] ?? null : null;
  const isCrossDevice = !!masterDeviceId && status === "connected";

  // P0 Gate 1c: ONE pending source-transition intent for this controller (lib/url-transition-intent.ts — the same pure
  // rules the station / web layer uses). Observed from the mirrored STATE_UPDATE; MAIN also de-duplicates (Gate 1a).
  const [transition, setTransitionState] = useState<UrlTransition | null>(null);
  const transitionRef = useRef<UrlTransition | null>(null);
  const remoteStateRef = useRef<StationPlaybackState | null>(remoteState);
  const [heldState, setHeldState] = useState<StationPlaybackState | null>(null);
  const setTransition = useCallback((t: UrlTransition | null) => {
    if (t === transitionRef.current) return;
    transitionRef.current = t;
    setTransitionState(t);
    if (!holdsAudible(t)) setHeldState(null); // P0 Gate 1f
  }, []);
  /** P0 Gate 1f: capture the audible state when a NEW hold begins (a hold in progress keeps the original). */
  const captureHeld = useCallback(() => {
    if (holdsAudible(transitionRef.current)) return;
    const rs = remoteStateRef.current;
    setHeldState(rs?.status === "playing" ? rs : null);
  }, []);
  useEffect(() => {
    remoteStateRef.current = remoteState;
    const cur = transitionRef.current;
    if (!cur) return;
    const res = observeTransition(cur, {
      mode: "remote",
      attemptId: typeof remoteState?.mpvAttemptId === "number" ? remoteState.mpvAttemptId : null, // P0 Gate 1d
      pending: typeof remoteState?.mpvAttemptPending === "boolean" ? remoteState.mpvAttemptPending : null, // P0 Gate 1f
      sourceId: remoteState?.currentSource?.id ?? null,
      trackIndex: typeof remoteState?.currentTrackIndex === "number" ? remoteState.currentTrackIndex : null,
      status: remoteState?.status ?? "idle",
      position: typeof remoteState?.position === "number" ? remoteState.position : 0,
      error: remoteState?.mpvEngineError ?? null,
      engineReady: remoteState?.mpvEngineReady !== false,
    });
    // Folding an external STATE_UPDATE into the intent; setTransition is a no-op when nothing changed (no cascade).
    /* eslint-disable react-hooks/set-state-in-effect */
    if (res.event === "confirmed") setTransition(null);
    else if (res.event === "failed" && res.t) setTransition(failTransition(res.t, Date.now()));
    else setTransition(res.t);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [remoteState, setTransition]);
  useEffect(() => {
    if (!transition) return;
    const id = setInterval(() => setTransition(tickTransition(transitionRef.current, Date.now(), false)), 1000);
    return () => clearInterval(id);
  }, [transition, setTransition]);

  const sendPlay = useCallback(() => {
    if (decideUserCommand(transitionRef.current, { kind: "play" }) !== "accept") return; // P0 Gate 1c
    if (masterDeviceId) sendCommand(masterDeviceId, "PLAY");
  }, [masterDeviceId, sendCommand]);

  const sendPause = useCallback(() => {
    setTransition(null); // always allowed
    if (masterDeviceId) sendCommand(masterDeviceId, "PAUSE");
  }, [masterDeviceId, sendCommand, setTransition]);

  const sendStop = useCallback(() => {
    setTransition(null); // always allowed
    if (masterDeviceId) sendCommand(masterDeviceId, "STOP");
  }, [masterDeviceId, sendCommand, setTransition]);

  // P0 Gate 1d: MAIN relays NEXT / PREV to the station renderer (session owner) → one real step. ONE pending nav
  // intent here, bound to the next MAIN attempt via the mirrored mpvAttemptId (no target key: the owner picks it).
  const beginNav = useCallback((origin: "next" | "prev") => {
    const prior = remoteStateRef.current?.mpvAttemptId;
    if (typeof prior !== "number") return; // older MAIN (no mirrored attempt id) → no feedback rather than a stuck Loading
    captureHeld();
    setTransition(beginTransition({ origin, targetKey: null, now: Date.now(), priorAttemptId: prior, audibleAtStart: remoteStateRef.current?.status === "playing" }));
  }, [setTransition, captureHeld]);

  const sendNext = useCallback(() => {
    if (isBlocking(transitionRef.current)) return; // P0 Gate 1c: one navigation intent
    if (!masterDeviceId) return;
    beginNav("next");
    sendCommand(masterDeviceId, "NEXT");
  }, [masterDeviceId, sendCommand, beginNav]);

  const sendPrev = useCallback(() => {
    if (isBlocking(transitionRef.current)) return; // P0 Gate 1c
    if (!masterDeviceId) return;
    beginNav("prev");
    sendCommand(masterDeviceId, "PREV");
  }, [masterDeviceId, sendCommand, beginNav]);

  const sendPlaySource = useCallback(
    (source: UnifiedSource) => {
      if (!masterDeviceId) return;
      const key = targetKeyOf(source?.id, 0); // this path sends no trackIndex → MAIN mirrors index 0
      if (decideUserCommand(transitionRef.current, { kind: "select", targetKey: key }) !== "accept") return; // P0 Gate 1c
      const prior = remoteStateRef.current?.mpvAttemptId;
      captureHeld(); // P0 Gate 1f
      const t = beginTransition({ origin: "select", targetKey: key, now: Date.now(), priorAttemptId: typeof prior === "number" ? prior : null, audibleAtStart: remoteStateRef.current?.status === "playing" });
      transitionRef.current = t;
      setTransitionState(t);
      sendCommand(masterDeviceId, "PLAY_SOURCE", { source: unifiedSourceToPayload(source) });
    },
    [masterDeviceId, sendCommand, captureHeld]
  );

  // Add to queue on the MASTER — reuses the existing QUEUE_NEXT command (same
  // sendCommand path as PLAY_SOURCE). The MASTER enqueues via addPlayNextSources
  // and echoes the updated playNextQueue back through STATE_UPDATE. No local audio.
  const sendQueueNext = useCallback(
    (source: UnifiedSource) => {
      if (masterDeviceId) {
        sendCommand(masterDeviceId, "QUEUE_NEXT", { source: unifiedSourceToPayload(source) });
      }
    },
    [masterDeviceId, sendCommand]
  );

  const sendSeek = useCallback(
    (seconds: number) => {
      if (masterDeviceId && Number.isFinite(seconds)) {
        sendCommand(masterDeviceId, "SEEK", { position: seconds });
      }
    },
    [masterDeviceId, sendCommand]
  );

  const sendSetVolume = useCallback(
    (volume: number) => {
      if (masterDeviceId && Number.isFinite(volume)) {
        sendCommand(masterDeviceId, "SET_VOLUME", { volume: Math.max(0, Math.min(100, volume)) });
      }
    },
    [masterDeviceId, sendCommand]
  );

  // Random/AutoMix as REAL remote actions (not just mirrored display). These reuse
  // the EXISTING protocol: the SET_SHUFFLE / SET_AUTOMIX RemoteCommands are already
  // routed by the server and executed by the MASTER (device-player-context handles
  // them → setShuffle/setAutoMix), which then broadcasts a fresh STATE_UPDATE back
  // to every CONTROL. We send the ABSOLUTE desired value (not a flip): the button's
  // displayed state comes only from remoteState, so a double-click can never desync
  // into a wrong optimistic state — the last value simply wins.
  const sendSetShuffle = useCallback(
    (value: boolean) => {
      if (masterDeviceId) sendCommand(masterDeviceId, "SET_SHUFFLE", { value });
    },
    [masterDeviceId, sendCommand]
  );

  const sendSetAutoMix = useCallback(
    (value: boolean) => {
      if (masterDeviceId) sendCommand(masterDeviceId, "SET_AUTOMIX", { value });
    },
    [masterDeviceId, sendCommand]
  );

  const sendSetRepeatMode = useCallback(
    (mode: "playlist" | "track" | "off") => {
      if (masterDeviceId) sendCommand(masterDeviceId, "SET_REPEAT_MODE", { mode });
    },
    [masterDeviceId, sendCommand]
  );

  const value = useMemo(
    () => ({
      isCrossDevice,
      selectedDeviceId: masterDeviceId,
      setSelectedDeviceId: () => {},
      remoteState,
      transition,
      transitionHeldState: holdsAudible(transition) ? heldState : null,
      status,
      devices,
      sendPlay,
      sendPause,
      sendStop,
      sendNext,
      sendPrev,
      sendPlaySource,
      sendQueueNext,
      sendSeek,
      sendSetVolume,
      sendSetShuffle,
      sendSetAutoMix,
      sendSetRepeatMode,
    }),
    [
      isCrossDevice,
      masterDeviceId,
      remoteState,
      transition,
      heldState,
      status,
      devices,
      sendPlay,
      sendPause,
      sendStop,
      sendNext,
      sendPrev,
      sendPlaySource,
      sendQueueNext,
      sendSeek,
      sendSetVolume,
      sendSetShuffle,
      sendSetAutoMix,
      sendSetRepeatMode,
    ]
  );

  return (
    <StationControllerContext.Provider value={value}>
      {children}
      <GuestRecommendationModal
        recommendation={pendingGuestRecommendation}
        onClose={() => setPendingGuestRecommendation(null)}
        onApprove={(id) => {
          sendApproveGuestRecommend(id);
          setPendingGuestRecommendation(null);
        }}
        onReject={(id) => {
          sendRejectGuestRecommend(id);
          setPendingGuestRecommendation(null);
        }}
      />
    </StationControllerContext.Provider>
  );
}

export function useStationController() {
  const ctx = useContext(StationControllerContext);
  return ctx ?? {
    isCrossDevice: false,
    selectedDeviceId: null,
    setSelectedDeviceId: () => {},
    remoteState: null,
    transition: null,
    transitionHeldState: null,
    status: "disconnected" as const,
    devices: [] as DeviceInfo[],
    sendPlay: () => {},
    sendPause: () => {},
    sendStop: () => {},
    sendNext: () => {},
    sendPrev: () => {},
    sendPlaySource: () => {},
    sendQueueNext: () => {},
    sendSeek: () => {},
    sendSetVolume: () => {},
    sendSetShuffle: () => {},
    sendSetAutoMix: () => {},
    sendSetRepeatMode: () => {},
  };
}

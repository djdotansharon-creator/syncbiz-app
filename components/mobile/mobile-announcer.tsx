"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Mobile Announcer — "Record My Performance" (Parts B + C).
 *
 * A premium, full-screen, phone-first recording surface. It records the user's voice with the
 * real MediaRecorder pipeline (same shape as mobile-listen-identify: mime pick → getUserMedia →
 * MediaRecorder → Blob) and plays it back LOCALLY in the browser only.
 *
 * OFF-PLAYBACK: nothing here touches the store playback runtime (MPV / MASTER / CONTROL / queue /
 * ducking). Audio preview uses a private, detached <audio> element. The "Make it sound
 * professional" CTA is capability-GATED against /api/voice/convert — which is not enabled in v1,
 * so it honestly reports "unavailable" rather than faking a conversion.
 */

type Phase = "ready" | "recording" | "recorded" | "processing" | "unavailable" | "result";

const MAX_MS = 120_000; // safety cap — a single announcement take

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"]) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return "";
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function MobileAnnouncer() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("ready");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [convertMsg, setConvertMsg] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>("");
  const blobRef = useRef<Blob | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const capRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── teardown helpers ──
  const stopTicker = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    if (capRef.current) clearTimeout(capRef.current);
    capRef.current = null;
  }, []);

  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const stopPreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setPlaying(false);
  }, []);

  const dropRecording = useCallback(() => {
    stopPreview();
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    blobRef.current = null;
    chunksRef.current = [];
  }, [stopPreview]);

  // Full cleanup on unmount — release mic + media stream + object URL + timers.
  useEffect(() => {
    return () => {
      stopTicker();
      try {
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      } catch {
        /* ignore */
      }
      releaseMic();
      if (audioRef.current) audioRef.current.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, [stopTicker, releaseMic]);

  // ── recording ──
  const startRecording = useCallback(async () => {
    setError(null);
    setConvertMsg(null);
    dropRecording();

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't record audio.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access is needed. Enable it in your browser settings and try again.");
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    const mime = pickMimeType();
    mimeRef.current = mime;
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch {
      setError("This browser can't record audio.");
      releaseMic();
      return;
    }
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      stopTicker();
      const blob = new Blob(chunksRef.current, { type: mimeRef.current || "audio/webm" });
      releaseMic();
      if (blob.size > 0) {
        blobRef.current = blob;
        audioUrlRef.current = URL.createObjectURL(blob);
        setPhase("recorded");
      } else {
        setError("Didn't capture any audio. Please try again.");
        setPhase("ready");
      }
    };
    recorder.start();
    startedAtRef.current = Date.now();
    setElapsed(0);
    setPhase("recording");
    tickRef.current = setInterval(() => setElapsed(Date.now() - startedAtRef.current), 200);
    capRef.current = setTimeout(() => {
      try {
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      } catch {
        /* ignore */
      }
    }, MAX_MS);
  }, [dropRecording, releaseMic, stopTicker]);

  const stopRecording = useCallback(() => {
    try {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const reRecord = useCallback(() => {
    dropRecording();
    setError(null);
    setConvertMsg(null);
    setPhase("ready");
  }, [dropRecording]);

  // ── local preview (browser only) ──
  const togglePreview = useCallback(() => {
    if (!audioUrlRef.current) return;
    if (!audioRef.current) {
      const a = new Audio();
      a.onended = () => setPlaying(false);
      a.onpause = () => setPlaying(false);
      audioRef.current = a;
    }
    const a = audioRef.current;
    if (playing) {
      a.pause();
      a.currentTime = 0;
      setPlaying(false);
    } else {
      a.src = audioUrlRef.current;
      void a.play().then(() => setPlaying(true)).catch(() => setError("Preview failed to play."));
    }
  }, [playing]);

  // ── capability-gated "Make it sound professional" (Part D boundary) ──
  const makeProfessional = useCallback(async () => {
    if (!blobRef.current) return;
    stopPreview();
    setPhase("processing");
    setConvertMsg(null);
    try {
      const fd = new FormData();
      fd.append("locale", "he-IL");
      fd.append("audio", blobRef.current, `take.${(mimeRef.current.split("/")[1] || "webm").split(";")[0]}`);
      const res = await fetch("/api/voice/convert", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      // v1: convert is intentionally not enabled → 501. Report honestly, never fake a result.
      if (res.status === 501 || j?.enabled === false) {
        setConvertMsg(j?.reason || "Professional conversion isn't available yet.");
        setPhase("unavailable");
        return;
      }
      if (!res.ok) throw new Error(j?.error || `convert ${res.status}`);
      setPhase("result");
    } catch (e) {
      setConvertMsg(e instanceof Error ? e.message : String(e));
      setPhase("unavailable");
    }
  }, [stopPreview]);

  const goBack = useCallback(() => {
    stopPreview();
    router.push("/mobile/home");
  }, [router, stopPreview]);

  const recording = phase === "recording";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "radial-gradient(120% 90% at 50% 0%, #16181d 0%, #050506 60%)",
        color: "#f4f5f7",
        display: "flex",
        flexDirection: "column",
        paddingTop: "max(env(safe-area-inset-top), 14px)",
        paddingBottom: "max(env(safe-area-inset-bottom), 18px)",
        paddingLeft: "max(env(safe-area-inset-left), 18px)",
        paddingRight: "max(env(safe-area-inset-right), 18px)",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 40 }}>
        <button onClick={goBack} aria-label="Back" style={{ background: "none", border: "none", color: "#9aa0a8", fontSize: 22, cursor: "pointer" }}>
          ‹
        </button>
        <span style={{ fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: "#7d838c", fontWeight: 600 }}>Announcer</span>
        <span style={{ width: 22 }} />
      </div>

      {/* Center stage */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 26 }}>
        <div style={{ textAlign: "center", minHeight: 24 }}>
          <div style={{ fontVariantNumeric: "tabular-nums", fontSize: recording ? 40 : 15, fontWeight: recording ? 300 : 500, color: recording ? "#fff" : "#8b9098", transition: "font-size .2s" }}>
            {recording || phase === "recorded" || phase === "processing" || phase === "unavailable" || phase === "result" ? fmt(elapsed) : "Ready to record"}
          </div>
        </div>

        {/* The button */}
        <button
          onClick={recording ? stopRecording : phase === "ready" ? startRecording : undefined}
          disabled={phase === "processing"}
          aria-label={recording ? "Stop recording" : "Start recording"}
          style={{
            width: 184,
            height: 184,
            borderRadius: "50%",
            border: recording ? "3px solid #ff453a" : "3px solid rgba(255,255,255,0.14)",
            background: recording
              ? "rgba(255,69,58,0.10)"
              : phase === "ready"
                ? "radial-gradient(circle at 50% 35%, #2a2d34, #101216)"
                : "rgba(255,255,255,0.04)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: phase === "ready" || recording ? "pointer" : "default",
            position: "relative",
            transition: "border-color .2s, background .2s",
          }}
        >
          {recording ? <span className="sb-rec-ring" /> : null}
          <span
            style={{
              display: "block",
              background: recording ? "#ff453a" : "#ff3b30",
              width: recording ? 54 : 68,
              height: recording ? 54 : 68,
              borderRadius: recording ? 12 : "50%",
              boxShadow: recording ? "none" : "0 0 30px rgba(255,59,48,0.45)",
              transition: "all .2s",
            }}
          />
        </button>

        <div style={{ fontSize: 14, color: "#8b9098", minHeight: 20 }}>
          {phase === "ready" ? "Tap to record" : recording ? "Recording… tap to stop" : phase === "recorded" ? "Nice take." : ""}
        </div>

        {error ? (
          <div style={{ color: "#ff6b6b", fontSize: 13, textAlign: "center", maxWidth: 300 }}>{error}</div>
        ) : null}
      </div>

      {/* Bottom actions */}
      <div style={{ minHeight: 132, display: "flex", flexDirection: "column", gap: 12 }}>
        {phase === "recorded" || phase === "result" ? (
          <>
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={togglePreview} style={secBtn}>
                {playing ? "■ Stop" : "▶ Listen"}
              </button>
              <button onClick={reRecord} style={secBtn}>
                ↺ Re-record
              </button>
            </div>
            <button onClick={() => void makeProfessional()} style={primaryBtn}>
              Make it sound professional
            </button>
          </>
        ) : null}

        {phase === "processing" ? (
          <div style={{ textAlign: "center", color: "#8b9098", fontSize: 14 }}>
            <span className="sb-spin" style={{ display: "inline-block", width: 18, height: 18, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.25)", borderTopColor: "#0a84ff", marginRight: 8, verticalAlign: "-3px" }} />
            Processing…
          </div>
        ) : null}

        {phase === "unavailable" ? (
          <>
            <div style={{ textAlign: "center", color: "#c7ccd3", fontSize: 13, lineHeight: 1.5, padding: "0 8px" }}>
              {convertMsg || "Professional conversion isn't available yet."}
              <div style={{ color: "#7d838c", fontSize: 12, marginTop: 4 }}>Your recording is saved on this device — you can still listen to it.</div>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={togglePreview} style={secBtn}>{playing ? "■ Stop" : "▶ Listen"}</button>
              <button onClick={reRecord} style={secBtn}>↺ Re-record</button>
            </div>
          </>
        ) : null}
      </div>

      <style>{`
        @keyframes sb-rec-pulse { 0% { transform: scale(1); opacity: .55 } 70% { transform: scale(1.28); opacity: 0 } 100% { opacity: 0 } }
        .sb-rec-ring { position: absolute; inset: -3px; border-radius: 50%; border: 3px solid #ff453a; animation: sb-rec-pulse 1.6s ease-out infinite; }
        @keyframes sb-spin { to { transform: rotate(360deg) } }
        .sb-spin { animation: sb-spin .8s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .sb-rec-ring, .sb-spin { animation: none; } }
      `}</style>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  width: "100%",
  padding: "15px",
  borderRadius: 14,
  border: "none",
  background: "#0a84ff",
  color: "#fff",
  fontSize: 16,
  fontWeight: 600,
  cursor: "pointer",
};

const secBtn: React.CSSProperties = {
  flex: 1,
  padding: "13px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.05)",
  color: "#f4f5f7",
  fontSize: 15,
  fontWeight: 500,
  cursor: "pointer",
};

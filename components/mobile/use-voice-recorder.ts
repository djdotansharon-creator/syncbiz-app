"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared mobile voice-recorder hook — the SAME MediaRecorder pipeline the Announcer uses
 * (mime pick → getUserMedia → MediaRecorder → Blob → local <audio>). OFF-PLAYBACK: it only ever
 * records and previews on THIS phone. It never uploads, never plays to a MASTER, and never touches
 * the remote/WS runtime. (mobile-announcer keeps its own copy for now; this hook is the reusable
 * mechanism for the merged Jingles screen — no new recording mechanism is introduced.)
 */

export type RecorderPhase = "idle" | "recording" | "recorded";

const MAX_MS = 120_000; // safety cap for a single take

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"]) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return "";
}

export function useVoiceRecorder() {
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>("");
  const audioUrlRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const capRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const reset = useCallback(() => {
    stopPreview();
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    chunksRef.current = [];
    setElapsed(0);
    setError(null);
    setPhase("idle");
  }, [stopPreview]);

  // Full cleanup on unmount — release mic + object URL + timers.
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

  const startRecording = useCallback(async () => {
    setError(null);
    stopPreview();
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    chunksRef.current = [];

    // On a phone the microphone is blocked unless the page is a SECURE context (https, or localhost).
    // Opening the dev server over http on a LAN IP (e.g. http://192.168.x.x:3000) makes
    // navigator.mediaDevices undefined — the #1 reason recording "does nothing" on a real phone.
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      setError("Recording needs a secure (HTTPS) connection on a phone. This page is not secure (http on a LAN IP blocks the mic). Open it over HTTPS.");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser doesn't expose the microphone (no mediaDevices). On a phone this usually means the connection isn't HTTPS.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Microphone permission was denied. Allow it for this site in your browser settings and try again."
          : name === "NotFoundError"
            ? "No microphone was found on this device."
            : `Couldn't access the microphone (${name ?? "unknown error"}).`,
      );
      return;
    }
    streamRef.current = stream;
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
        audioUrlRef.current = URL.createObjectURL(blob);
        setPhase("recorded");
      } else {
        setError("Didn't capture any audio. Please try again.");
        setPhase("idle");
      }
    };
    recorder.start(1000); // timeslice → periodic dataavailable (more reliable on mobile Safari/Chrome)
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
  }, [releaseMic, stopTicker, stopPreview]);

  const stopRecording = useCallback(() => {
    try {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    } catch {
      /* ignore */
    }
  }, []);

  // Local preview only (this phone's browser). Never sends a PLAY command.
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

  return { phase, elapsed, error, playing, startRecording, stopRecording, reset, togglePreview };
}

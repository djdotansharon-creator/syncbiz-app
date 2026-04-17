"use client";

import { useState, useEffect, useRef } from "react";

/**
 * Dev-only floating panel — visible only inside Electron (where window.syncbizDesktop is present).
 * Lets you send a URL or local file path directly to MPV without WS.
 */
export function DesktopMpvTestPanel() {
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState("");
  const [feedback, setFeedback] = useState("");

  // Live orchestrator debug state (updated via onStatus subscription)
  const [musicVol, setMusicVol] = useState<number | null>(null);
  const [musicStatus, setMusicStatus] = useState<string>("idle");
  const [isDucked, setIsDucked] = useState(false);
  const [duckTarget, setDuckTarget] = useState<number | null>(null);
  const [duckPercent, setDuckPercent] = useState<number>(40);
  const [duckLog, setDuckLog] = useState<string[]>([]);
  const isDuckedRef = useRef(false);
  const [interruptPending, setInterruptPending] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("syncbizDesktop" in window)) return;
    setVisible(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsub = (window as any).syncbizDesktop.onStatus((s: any) => {
      setMusicVol(s.mockVolume ?? null);
      setMusicStatus(s.mockPlaybackStatus ?? "idle");
      setDuckTarget(s.duckTargetVolume ?? null);
      if (typeof s.duckPercent === "number") setDuckPercent(s.duckPercent);

      const prevDucked = isDuckedRef.current;
      isDuckedRef.current = !!s.isDucked;
      setIsDucked(!!s.isDucked);

      if (!prevDucked && s.isDucked) {
        const ts = new Date().toLocaleTimeString();
        setDuckLog((l) => [`${ts}  DUCK START → target ${s.duckTargetVolume}`, ...l].slice(0, 6));
      } else if (prevDucked && !s.isDucked) {
        const ts = new Date().toLocaleTimeString();
        setDuckLog((l) => [`${ts}  DUCK END → restored ${s.mockVolume}`, ...l].slice(0, 6));
      }
    });

    return () => { if (typeof unsub === "function") unsub(); };
  }, []);

  if (!visible) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = () => (window as any).syncbizDesktop;

  const chABusy = musicStatus === "playing" || musicStatus === "paused";

  async function handlePlay() {
    if (musicStatus === "playing" || musicStatus === "paused") {
      setFeedback("Ch-A in use by real player — stop it first.");
      return;
    }
    const trimmed = url.trim();
    if (!trimmed) { setFeedback("Enter a URL or file path."); return; }
    try {
      setFeedback("Sending to music channel…");
      await api().mpvPlayUrl(trimmed);
      setFeedback("Music: sent.");
    } catch (e) {
      setFeedback(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleStop() {
    try {
      await api().localMockTransport({ command: "STOP" });
      setFeedback("Music: stopped.");
    } catch (e) {
      setFeedback(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleInterrupt() {
    if (interruptPending) return;
    const trimmed = url.trim();
    if (!trimmed) { setFeedback("Enter a URL or file path."); return; }
    setInterruptPending(true);
    try {
      setFeedback("Sending to interrupt channel…");
      await api().mpvPlayInterrupt(trimmed);
      setFeedback("Interrupt: queued (ducking music).");
    } catch (e) {
      setFeedback(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setInterruptPending(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid #334155",
    background: "#020617",
    color: "#f1f5f9",
    fontSize: 12,
    marginBottom: 8,
    boxSizing: "border-box",
  };

  const btnStyle = (bg: string): React.CSSProperties => ({
    padding: "6px 14px",
    borderRadius: 6,
    border: "none",
    background: bg,
    color: "white",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    marginRight: 6,
  });

  return (
    <div
      style={{
        position: "fixed",
        bottom: 80,
        right: 16,
        zIndex: 9999,
        background: "#0f172a",
        border: "1px dashed #fbbf24",
        borderRadius: 12,
        padding: "12px 16px",
        width: 310,
        fontFamily: "system-ui, sans-serif",
        boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
      }}
    >
      <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#fbbf24" }}>
        MPV Test
      </p>
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void handlePlay(); }}
        placeholder="URL or C:\path\to\file.mp3"
        style={inputStyle}
      />
      <div>
        <button
          type="button"
          onClick={() => void handlePlay()}
          disabled={chABusy}
          title={chABusy ? "Ch-A in use by real player — stop it first" : "Load URL on MPV Ch-A"}
          style={{ ...btnStyle("#3b82f6"), opacity: chABusy ? 0.4 : 1, cursor: chABusy ? "not-allowed" : "pointer" }}
        >
          Music
        </button>
        <button
          type="button"
          onClick={() => void handleInterrupt()}
          disabled={interruptPending}
          style={{ ...btnStyle("#7c3aed"), opacity: interruptPending ? 0.5 : 1, cursor: interruptPending ? "not-allowed" : "pointer" }}
        >
          {interruptPending ? "Queuing…" : "Interrupt"}
        </button>
        <button type="button" onClick={() => void handleStop()} style={btnStyle("#475569")}>
          Stop
        </button>
      </div>
      {feedback && (
        <p style={{ margin: "6px 0 0", fontSize: 11, color: feedback.startsWith("Error") ? "#f87171" : "#4ade80" }}>
          {feedback}
        </p>
      )}

      {/* Live duck debug readout */}
      <div style={{ marginTop: 10, borderTop: "1px solid #1e293b", paddingTop: 8 }}>
        <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#64748b" }}>
          Duck debug
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 8px", fontSize: 11 }}>
          <span style={{ color: "#64748b" }}>ch-A (MPV)</span>
          <span style={{
            color: musicStatus === "playing" ? "#4ade80" : musicStatus === "paused" ? "#fbbf24" : "#64748b",
            fontFamily: "monospace",
            fontWeight: 700,
          }}>
            {musicStatus}
          </span>
          <span style={{ color: "#64748b" }}>music vol</span>
          <span style={{ color: "#f1f5f9", fontFamily: "monospace" }}>
            {musicVol !== null ? musicVol : "—"}
          </span>
          <span style={{ color: "#64748b" }}>duck target</span>
          <span style={{ color: "#f1f5f9", fontFamily: "monospace" }}>
            {duckTarget !== null ? duckTarget : "—"}
          </span>
          <span style={{ color: "#64748b" }}>ducked?</span>
          <span style={{ color: isDucked ? "#fbbf24" : "#4ade80", fontFamily: "monospace", fontWeight: 700 }}>
            {isDucked ? "YES" : "no"}
          </span>
        </div>
        {/* Duck depth slider */}
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "#64748b", whiteSpace: "nowrap" }}>duck depth</span>
          <input
            type="range"
            min={0}
            max={80}
            step={5}
            value={duckPercent}
            onChange={(e) => {
              const v = Number(e.target.value);
              setDuckPercent(v);
              void api().setDuckPercent(v);
            }}
            style={{ flex: 1, accentColor: "#7c3aed" }}
          />
          <span style={{ fontSize: 10, fontFamily: "monospace", color: "#f1f5f9", minWidth: 28, textAlign: "right" }}>{duckPercent}%</span>
        </div>
        {isDucked && musicStatus !== "playing" && (
          <p style={{ margin: "6px 0 0", fontSize: 10, color: "#fb923c", fontWeight: 700 }}>
            ⚠ MPV ch-A not playing — web app AudioPlayer may be the audible source. Stop web app audio first.
          </p>
        )}
        {duckLog.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {duckLog.map((line, i) => (
              <p key={i} style={{ margin: "1px 0", fontSize: 10, fontFamily: "monospace", color: line.includes("START") ? "#fbbf24" : "#4ade80" }}>
                {line}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

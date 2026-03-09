"""
SyncBiz local Windows agent (MVP).
Polls the SyncBiz app for commands and executes playback on this machine.
No authentication. Windows only.

Usage:
  1. Start SyncBiz: npm run dev
  2. Create a Local Playlist source with path e.g. C:\\SyncBiz\\playlists\\test.m3u
  3. Run this agent: python agent.py
  4. Click "Play now" on that source — agent will run: start "" "<path>"

Optional: set SYNCBIZ_AGENT_URL to override (default http://127.0.0.1:3000/api/agent/commands)
"""

import json
import os
import subprocess
import sys
import time
import urllib.request

POLL_URL = os.environ.get("SYNCBIZ_AGENT_URL", "http://127.0.0.1:3000/api/agent/commands")
POLL_INTERVAL_SEC = 10


def poll_command():
    """Fetch next pending command. Returns dict or None."""
    try:
        req = urllib.request.Request(POLL_URL)
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            return data.get("command")
    except Exception as e:
        print(f"Poll error: {e}", file=sys.stderr)
        return None


def run_play_local_playlist(path: str) -> bool:
    """Launch playlist with Windows default player. Returns True on success."""
    if not path or not path.strip():
        return False
    path = path.strip().strip('"')
    try:
        # start "" "path" — opens path with default app (e.g. .m3u -> music player)
        subprocess.run(
            ["cmd", "/c", "start", '""', path],
            check=True,
        )
        print(f"Launched: {path}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"Failed to launch {path}: {e}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return False


def main():
    print("SyncBiz local agent (Windows MVP) — polling every", POLL_INTERVAL_SEC, "s")
    print("Endpoint:", POLL_URL)
    print("Press Ctrl+C to stop.\n")

    while True:
        cmd = poll_command()
        if cmd and isinstance(cmd, dict):
            if cmd.get("type") == "PLAY_LOCAL_PLAYLIST":
                path = cmd.get("path") or ""
                run_play_local_playlist(path)
        time.sleep(POLL_INTERVAL_SEC)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")

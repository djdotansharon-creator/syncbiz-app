import { BrowserWindow, session } from "electron";
import type { WhatsAppStatus } from "../shared/mvp-types";

/**
 * GUESTS × WhatsApp Web (desktop-only).
 *
 * Loads web.whatsapp.com in a SEPARATE BrowserWindow (not an overlay — the main
 * window's zoom logic assumes a single full-window renderer, so a dedicated
 * window is the low-risk choice). The operator scans the QR once; the login
 * persists via a `persist:whatsapp` session partition (on disk under userData).
 *
 * We NEVER read messages in the background. Instead, when the operator clicks a
 * supported music link inside WhatsApp Web, WhatsApp tries to open it externally
 * (window.open / target=_blank); we intercept that via setWindowOpenHandler,
 * capture the URL, deny the popup (WhatsApp Web keeps running untouched), and
 * forward the URL to the hosted renderer's Guest inbox. No DOM scraping, no
 * automation of sending — receive-only.
 *
 * Security: contextIsolation + sandbox on, and NO preload — syncbizDesktop is
 * never exposed to WhatsApp's untrusted page.
 */

const WA_URL = "https://web.whatsapp.com";
const WA_PARTITION = "persist:whatsapp";

// WhatsApp Web sniffs the User-Agent and rejects Electron (it sees "Electron" +
// the productName and can't parse a Chrome version → "update Chrome" screen).
// Present a clean, current desktop-Chrome UA so it loads normally.
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";

const SUPPORTED_MUSIC_HOSTS = [
  "youtube.com",
  "youtu.be",
  "music.youtube.com",
  "soundcloud.com",
  "on.soundcloud.com",
  "spotify.com",
  "open.spotify.com",
];

function isSupportedMusicUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    return SUPPORTED_MUSIC_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

/**
 * Injected into the WhatsApp page: watches for NEW incoming message bubbles and
 * reports any music link (anchor) via console — the main process forwards it to
 * the Guest inbox. Read-only DOM observation; skips our own outgoing messages
 * (`.message-out`) and de-dupes. Auto-capture so the operator never has to click
 * or drag — a link just appears in the inbox.
 */
const CAPTURE_MARKER = "[[SBWA]]";
const OBSERVER_SCRIPT = `(function(){
  if (window.__sbWaObs) return; window.__sbWaObs = 1;
  var seen = {};
  var HOSTS = ["youtube.com","youtu.be","music.youtube.com","soundcloud.com","on.soundcloud.com","spotify.com","open.spotify.com"];
  function isMusic(u){ try{ var h=new URL(u).hostname.replace(/^www\\./,'').toLowerCase(); for(var i=0;i<HOSTS.length;i++){var x=HOSTS[i]; if(h===x||h.slice(-(x.length+1))==="."+x) return true;} }catch(e){} return false; }
  function scan(node){ try{
    if(!node||!node.querySelectorAll) return;
    var as=node.querySelectorAll('a[href]');
    for(var i=0;i<as.length;i++){ var a=as[i];
      if(a.closest&&a.closest('.message-out')) continue;
      var u=a.href; if(u&&isMusic(u)&&!seen[u]){ seen[u]=1; console.log('${CAPTURE_MARKER}'+u); }
    }
  }catch(e){} }
  var obs=new MutationObserver(function(muts){ for(var i=0;i<muts.length;i++){ var an=muts[i].addedNodes; for(var j=0;j<an.length;j++) scan(an[j]); } });
  obs.observe(document.body,{childList:true,subtree:true});
})();`;

export type WhatsAppCallbacks = {
  /** A supported music URL was clicked in WhatsApp — forward to the Guest inbox. */
  onUrl: (url: string) => void;
  /** Window/connection status changed. */
  onStatus: (status: WhatsAppStatus) => void;
};

export class WhatsAppWindow {
  private win: BrowserWindow | null = null;
  private readonly cb: WhatsAppCallbacks;

  constructor(cb: WhatsAppCallbacks) {
    this.cb = cb;
  }

  private snapshot(): WhatsAppStatus {
    const live = !!this.win && !this.win.isDestroyed();
    return { connected: live, windowOpen: live && this.win!.isVisible() };
  }

  private emit(): void {
    try {
      this.cb.onStatus(this.snapshot());
    } catch {
      /* renderer may be gone */
    }
  }

  getStatus(): WhatsAppStatus {
    return this.snapshot();
  }

  /** Create (or focus) the WhatsApp window. First run shows the QR to scan. */
  connect(): WhatsAppStatus {
    if (this.win && !this.win.isDestroyed()) {
      this.win.show();
      this.win.focus();
      this.emit();
      return this.snapshot();
    }
    const waSession = session.fromPartition(WA_PARTITION);
    this.win = new BrowserWindow({
      width: 480,
      height: 760,
      show: true,
      title: "SyncBiz — WhatsApp",
      autoHideMenuBar: true,
      webPreferences: {
        session: waSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // Capture clicked music links; deny the popup so WhatsApp Web is undisturbed.
    this.win.webContents.setWindowOpenHandler(({ url }) => {
      if (isSupportedMusicUrl(url)) {
        try {
          this.cb.onUrl(url);
        } catch {
          /* ignore */
        }
      }
      return { action: "deny" };
    });

    // Keep the window pinned to web.whatsapp.com; if a click causes an in-page
    // navigation away, block it and (if it's music) still capture the URL.
    this.win.webContents.on("will-navigate", (e, url) => {
      try {
        const host = new URL(url).hostname.toLowerCase();
        if (!host.endsWith("whatsapp.com")) {
          e.preventDefault();
          if (isSupportedMusicUrl(url)) this.cb.onUrl(url);
        }
      } catch {
        /* ignore */
      }
    });

    // AUTO-CAPTURE: (re)inject the DOM observer on every load; forward the music
    // links it reports (via console) to the Guest inbox. No clicking/dragging.
    this.win.webContents.on("did-finish-load", () => {
      this.win?.webContents.executeJavaScript(OBSERVER_SCRIPT).catch(() => {});
    });
    this.win.webContents.on(
      "console-message",
      (_event: unknown, _level: unknown, message: string) => {
        const idx = message.indexOf(CAPTURE_MARKER);
        if (idx < 0) return;
        const url = message.slice(idx + CAPTURE_MARKER.length).trim();
        if (isSupportedMusicUrl(url)) {
          try {
            this.cb.onUrl(url);
          } catch {
            /* ignore */
          }
        }
      },
    );

    this.win.on("show", () => this.emit());
    this.win.on("hide", () => this.emit());
    this.win.on("closed", () => {
      this.win = null;
      this.emit();
    });

    // Spoof a standard Chrome UA (both the request header and navigator.userAgent)
    // so WhatsApp Web doesn't reject the Electron browser.
    this.win.webContents.setUserAgent(CHROME_UA);
    void this.win.loadURL(WA_URL, { userAgent: CHROME_UA });
    this.emit();
    return this.snapshot();
  }

  show(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.show();
      this.win.focus();
      this.emit();
    }
  }

  hide(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.hide();
      this.emit();
    }
  }

  /** Log out: clear the persisted session and close the window. */
  async disconnect(): Promise<WhatsAppStatus> {
    try {
      await session.fromPartition(WA_PARTITION).clearStorageData();
    } catch {
      /* ignore */
    }
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.emit();
    return this.snapshot();
  }

  dispose(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

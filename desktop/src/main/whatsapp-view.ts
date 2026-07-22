import { WebContentsView, BrowserWindow, session } from "electron";
import type { WhatsAppStatus, WhatsAppBounds } from "../shared/mvp-types";

/**
 * GUESTS × WhatsApp Web (desktop-only) — EMBEDDED inside the player.
 *
 * Loads web.whatsapp.com in a `WebContentsView` that is added as a child of the
 * MAIN window's contentView and positioned over a rectangle the renderer marks
 * out inside the Guest drawer (like the "Moni" Chrome add-on embeds WhatsApp
 * inside Monday). It is NOT a separate OS window — it feels like part of the app.
 *
 * Coordinate mapping: the main renderer is zoomed via `setZoomFactor` (0.55–1.0),
 * so the renderer's `getBoundingClientRect` is in *logical* CSS px. A WebContentsView
 * lives in the window's *content* (DIP) space, so we multiply the rect by the
 * current zoom factor before `setBounds`. The renderer re-sends the rect on
 * resize/scroll so zoom changes stay in sync.
 *
 * The operator scans the QR once; the login persists via a `persist:whatsapp`
 * session partition (on disk under userData). The view stays ALIVE even when the
 * drawer is closed (just detached from the view tree) so incoming music links are
 * still auto-captured in the background.
 *
 * We NEVER read messages off to a server. When the operator clicks a supported
 * music link inside WhatsApp Web, WhatsApp tries to open it externally
 * (window.open / target=_blank); we intercept via setWindowOpenHandler, capture
 * the URL, deny the popup, and forward it to the renderer's Guest inbox. A DOM
 * observer also auto-captures links from newly-arrived messages. Receive-only.
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
// Burst-suppression: opening a chat / scrolling renders a BATCH of old messages
// at once; only a genuinely-new arrival trickles in alone. We buffer candidates
// for 900ms — a small buffer (≤3) is real arrivals → report; a large buffer is
// history → drop. `seen` de-dupes permanently so nothing repeats.
// "Solo chat" declutter (MONI-style): show ONLY the open conversation. Rather than
// guess WhatsApp's ever-changing class names, we hide every SIBLING of `#main`
// (the conversation) — that removes both the chat-LIST column (#side) AND the left
// icon NAV rail in one shot, whatever they're called — and stretch `#main` to full
// width. `#main` only exists once a chat is open, so before that the list stays
// visible (the operator can pick a chat); the 1s re-apply then goes solo. Toggling
// `window.__sbSolo` + calling `window.__sbSoloApply()` switches it live.
const SOLO_INSTALL = `(function(){
  function apply(){
    try {
      var main = document.getElementById('main');
      if (!main || !main.parentElement) return;
      var kids = main.parentElement.children;
      for (var i=0;i<kids.length;i++){
        var el = kids[i];
        if (el === main){ el.style.flex='1 1 100%'; el.style.maxWidth='100%'; el.style.width='100%'; }
        else { el.style.display = window.__sbSolo ? 'none' : ''; }
      }
      if (!window.__sbSolo){ main.style.flex=''; main.style.maxWidth=''; main.style.width=''; }
    } catch(e){}
  }
  window.__sbSoloApply = apply;
  apply();
  if (!window.__sbSoloInt) window.__sbSoloInt = setInterval(apply, 1000);
})();`;

const OBSERVER_SCRIPT = `(function(){
  if (window.__sbWaObs) return; window.__sbWaObs = 1;
  var seen = {}, buffer = [], timer = null, MARK = '${CAPTURE_MARKER}';
  var HOSTS = ["youtube.com","youtu.be","music.youtube.com","soundcloud.com","on.soundcloud.com","spotify.com","open.spotify.com"];
  function isMusic(u){ try{ var h=new URL(u).hostname.replace(/^www\\./,'').toLowerCase(); for(var i=0;i<HOSTS.length;i++){var x=HOSTS[i]; if(h===x||h.slice(-(x.length+1))==="."+x) return true;} }catch(e){} return false; }
  function consider(u){
    if(seen[u]) return; seen[u]=1;
    buffer.push(u);
    if(timer) clearTimeout(timer);
    timer=setTimeout(function(){
      if(buffer.length<=3){ for(var i=0;i<buffer.length;i++) console.log(MARK+buffer[i]); }
      buffer=[];
    },900);
  }
  function scan(node){ try{
    if(!node||!node.querySelectorAll) return;
    var as=node.querySelectorAll('a[href]');
    for(var i=0;i<as.length;i++){ var a=as[i];
      if(a.closest&&a.closest('.message-out')) continue;
      var u=a.href; if(u&&isMusic(u)) consider(u);
    }
  }catch(e){} }
  var obs=new MutationObserver(function(muts){ for(var i=0;i<muts.length;i++){ var an=muts[i].addedNodes; for(var j=0;j<an.length;j++) scan(an[j]); } });
  obs.observe(document.body,{childList:true,subtree:true});
})();`;

export type WhatsAppCallbacks = {
  /** A supported music URL was clicked in WhatsApp — forward to the Guest inbox. */
  onUrl: (url: string) => void;
  /** View/connection status changed. */
  onStatus: (status: WhatsAppStatus) => void;
};

export class WhatsAppWindow {
  private view: WebContentsView | null = null;
  private attached = false;
  private lastBounds: WhatsAppBounds | null = null;
  /** MONI-style: show only the open conversation (hide the chat list). Default on. */
  private soloMode = true;
  private readonly cb: WhatsAppCallbacks;
  private readonly getWindow: () => BrowserWindow | null;

  constructor(cb: WhatsAppCallbacks, getWindow: () => BrowserWindow | null) {
    this.cb = cb;
    this.getWindow = getWindow;
  }

  private snapshot(): WhatsAppStatus {
    const live = !!this.view;
    return { connected: live, windowOpen: live && this.attached };
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

  /** Wire capture handlers on the WhatsApp webContents (once, at creation). */
  private wire(view: WebContentsView): void {
    const wc = view.webContents;

    // Capture clicked music links; deny the popup so WhatsApp Web is undisturbed.
    wc.setWindowOpenHandler(({ url }) => {
      if (isSupportedMusicUrl(url)) {
        try {
          this.cb.onUrl(url);
        } catch {
          /* ignore */
        }
      }
      return { action: "deny" };
    });

    // Keep the view pinned to web.whatsapp.com; if a click causes an in-page
    // navigation away, block it and (if it's music) still capture the URL.
    wc.on("will-navigate", (e, url) => {
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

    // On every load: set the current solo state + install the solo controller, then
    // (re)inject the DOM observer that auto-forwards music links to the Guest inbox.
    wc.on("did-finish-load", () => {
      wc.executeJavaScript(`window.__sbSolo=${this.soloMode};`).catch(() => {});
      wc.executeJavaScript(SOLO_INSTALL).catch(() => {});
      wc.executeJavaScript(OBSERVER_SCRIPT).catch(() => {});
    });
    wc.on("console-message", (_event: unknown, _level: unknown, message: string) => {
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
    });
  }

  /** Convert the logical (CSS px) rect to window-content DIP and apply it. */
  private applyBounds(mainWin: BrowserWindow, rect: WhatsAppBounds): void {
    if (!this.view) return;
    let z = 1;
    try {
      z = mainWin.webContents.getZoomFactor() || 1;
    } catch {
      z = 1;
    }
    this.view.setBounds({
      x: Math.round(rect.x * z),
      y: Math.round(rect.y * z),
      width: Math.max(0, Math.round(rect.width * z)),
      height: Math.max(0, Math.round(rect.height * z)),
    });
  }

  /** Ensure the view is in the main window's view tree and positioned. */
  private attach(mainWin: BrowserWindow): void {
    if (!this.view) return;
    if (!this.attached) {
      mainWin.contentView.addChildView(this.view);
      this.attached = true;
    }
    if (this.lastBounds) this.applyBounds(mainWin, this.lastBounds);
  }

  /** Create (or re-show) the embedded WhatsApp view. First run shows the QR. */
  connect(): WhatsAppStatus {
    const mainWin = this.getWindow();
    if (!mainWin || mainWin.isDestroyed()) return this.snapshot();

    if (!this.view) {
      const waSession = session.fromPartition(WA_PARTITION);
      this.view = new WebContentsView({
        webPreferences: {
          session: waSession,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      this.wire(this.view);
      this.view.webContents.setUserAgent(CHROME_UA);
      void this.view.webContents.loadURL(WA_URL, { userAgent: CHROME_UA });
    }

    this.attach(mainWin);
    this.emit();
    return this.snapshot();
  }

  /** Renderer sends the target rect (logical CSS px). Implies "show". */
  setBounds(rect: WhatsAppBounds): void {
    this.lastBounds = rect;
    const mainWin = this.getWindow();
    if (!this.view || !mainWin || mainWin.isDestroyed()) return;
    this.attach(mainWin);
  }

  /** Toggle MONI-style solo view (only the open conversation; list + nav hidden). */
  setSoloMode(on: boolean): void {
    this.soloMode = on;
    if (this.view) {
      this.view.webContents
        .executeJavaScript(`window.__sbSolo=${on}; window.__sbSoloApply && window.__sbSoloApply();`)
        .catch(() => {});
    }
  }

  isSolo(): boolean {
    return this.soloMode;
  }

  /** Re-attach the view (used by an explicit "Open" action). */
  show(): void {
    const mainWin = this.getWindow();
    if (mainWin && !mainWin.isDestroyed()) this.attach(mainWin);
    this.emit();
  }

  /** Detach from the view tree (drawer closed). The webContents stays alive so
   *  background auto-capture of new messages keeps working. */
  hide(): void {
    const mainWin = this.getWindow();
    if (this.view && this.attached && mainWin && !mainWin.isDestroyed()) {
      mainWin.contentView.removeChildView(this.view);
    }
    this.attached = false;
    this.emit();
  }

  /** Log out: clear the persisted session and destroy the view. */
  async disconnect(): Promise<WhatsAppStatus> {
    const mainWin = this.getWindow();
    if (this.view) {
      if (this.attached && mainWin && !mainWin.isDestroyed()) {
        try {
          mainWin.contentView.removeChildView(this.view);
        } catch {
          /* ignore */
        }
      }
      try {
        this.view.webContents.close();
      } catch {
        /* ignore */
      }
      this.view = null;
    }
    this.attached = false;
    this.lastBounds = null;
    try {
      await session.fromPartition(WA_PARTITION).clearStorageData();
    } catch {
      /* ignore */
    }
    this.emit();
    return this.snapshot();
  }

  dispose(): void {
    const mainWin = this.getWindow();
    if (this.view) {
      if (this.attached && mainWin && !mainWin.isDestroyed()) {
        try {
          mainWin.contentView.removeChildView(this.view);
        } catch {
          /* ignore */
        }
      }
      try {
        this.view.webContents.close();
      } catch {
        /* ignore */
      }
      this.view = null;
    }
    this.attached = false;
  }
}

/**
 * Graphics mode — the part the SERVER layout needs (no React here, so a server component may import it). The hooks live in lib/fx-mode.ts.
 */
export const FX_STORAGE_KEY = "syncbiz-fx";
/** The deck's blurred "mirror" clip is a SECOND muted YouTube player — the heaviest decoration there is. It is switched off, through the
 *  player's own existing off-switch (localStorage `syncbiz:deckMirror`), in the Light graphics AND in the black / white displays (owner
 *  2026-10-25), and only given back if it was this rule that switched it off. */
/** the display mode (black / white / song) — owned by components/player-surface/ambient-video-background.tsx */
export const FX_DISPLAY_KEY = "syncbiz:displayMode";
export const FX_MIRROR_KEY = "syncbiz:deckMirror";
export const FX_MIRROR_OWNED_KEY = "syncbiz-fx-mirror-owned";

/**
 * The same decision, as a tiny script for <head>: it runs before the first paint so the page never flashes the full look first.
 * Keep it in step with `detectWeakGraphics` below (plain ES5, no imports).
 */
export const FX_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,s=localStorage,q=/[?&]fx=(lite|full)/.exec(location.search);if(q){try{s.setItem("${FX_STORAGE_KEY}",q[1])}catch(e){}}var m=s.getItem("${FX_STORAGE_KEY}");if(m!=="lite"&&m!=="full"){m="full";var weak=false;var n=navigator;if(n.hardwareConcurrency&&n.hardwareConcurrency<=4)weak=true;if(n.deviceMemory&&n.deviceMemory<=4)weak=true;try{var c=document.createElement("canvas"),g=c.getContext("webgl")||c.getContext("experimental-webgl");if(g){var x=g.getExtension("WEBGL_debug_renderer_info");var r=x?String(g.getParameter(x.UNMASKED_RENDERER_WEBGL)):"";if(/SwiftShader|llvmpipe|Software|Basic Render/i.test(r)||(/Windows/i.test(n.userAgent)&&/Intel\\(R\\) (UHD|HD) Graphics/i.test(r)))weak=true}else{weak=true}}catch(e){}if(weak)m="lite"}if(m==="lite")d.setAttribute("data-sb-fx","lite");else d.removeAttribute("data-sb-fx");var dm=s.getItem("${FX_DISPLAY_KEY}");if(m==="lite"||dm==="black"||dm==="white"){if(s.getItem("${FX_MIRROR_KEY}")!=="off"){s.setItem("${FX_MIRROR_KEY}","off");s.setItem("${FX_MIRROR_OWNED_KEY}","1")}}else if(s.getItem("${FX_MIRROR_OWNED_KEY}")==="1"){s.removeItem("${FX_MIRROR_KEY}");s.removeItem("${FX_MIRROR_OWNED_KEY}")}}catch(e){}})();`;


/**
 * A device that was left on the locked display screen starts on its colour at once (see app/kiosk-display.css) — no flash of the controller.
 * Two safety rules (owner 2026-10-26: "a dark blue screen that never loads"): the cover is only for the app's own pages — NEVER on the sign-in / sign-up / reset pages, where the display
 * screen does not exist to take it away again (a browser that kept the "locked" flag but whose sign-in had expired showed only the cover over the login page) — and if the display screen has
 * not come up within 10 s (a crash, a very slow start) the cover removes itself, so a page can never stay hidden behind it.
 */
export const KIOSK_BOOT_SCRIPT = `(function(){try{var p=location.pathname;if(p==="/"||/^\\/(login|signup|reset-password|forgot-password|suspended)(\\/|$)/.test(p))return;if(localStorage.getItem("syncbiz-kiosk-locked")==="1"){var d=document.documentElement;d.setAttribute("data-sb-kiosk-boot","locked");if(localStorage.getItem("syncbiz-kiosk-theme")==="light")d.setAttribute("data-sb-kiosk-theme","light");setTimeout(function(){if(!document.querySelector(".sb-kiosk-root"))d.removeAttribute("data-sb-kiosk-boot")},10000)}}catch(e){}})();`;

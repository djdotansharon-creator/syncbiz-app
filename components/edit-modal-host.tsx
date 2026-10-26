"use client";

/**
 * Edit dialog host — mounted once in the app layout. Every pencil / "Edit" link to `/playlists/<id>/edit` or
 * `/sources/<id>/edit` opens the stepped centred glass dialog over the current page instead of navigating away,
 * and the player's pencil (and any code) can open it with the `syncbiz:edit-open` window event
 * (`detail: { kind: "playlist" | "source", id }`). Modified clicks (⌘/ctrl/shift/middle) keep the normal link.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EditPlaylistForm } from "@/components/edit-playlist-form";
import { EditSourceForm } from "@/components/edit-source-form";

export const EDIT_MODAL_EVENT = "syncbiz:edit-open";
type Target = { kind: "playlist" | "source"; id: string };
const EDIT_HREF = /^\/(playlists|sources)\/([^/?#]+)\/edit\/?$/;
const EXIT_MS = 240;

export function EditModalHost() {
  const router = useRouter();
  const [target, setTarget] = useState<Target | null>(null);
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank") return;
      let u: URL;
      try {
        u = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (u.origin !== window.location.origin) return;
      const m = EDIT_HREF.exec(u.pathname);
      if (!m) return;
      e.preventDefault();
      e.stopPropagation();
      setClosing(false);
      setTarget({ kind: m[1] === "playlists" ? "playlist" : "source", id: decodeURIComponent(m[2]!) });
    };
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<Target>).detail;
      if (d && d.id && (d.kind === "playlist" || d.kind === "source")) {
        setClosing(false);
        setTarget({ kind: d.kind, id: d.id });
      }
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener(EDIT_MODAL_EVENT, onOpen);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(EDIT_MODAL_EVENT, onOpen);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const close = (refresh: boolean) => {
    setClosing(true);
    timer.current = setTimeout(() => {
      setTarget(null);
      setClosing(false);
      if (refresh) router.refresh();
    }, EXIT_MS);
  };

  if (!target) return null;
  return target.kind === "playlist" ? (
    <EditPlaylistForm key={`p:${target.id}`} id={target.id} presentation="wizard" modalClosing={closing} onDone={() => close(true)} onCancel={() => close(false)} hideTopBackLink />
  ) : (
    <EditSourceForm key={`s:${target.id}`} id={target.id} presentation="wizard" modalClosing={closing} onDone={() => close(true)} onCancel={() => close(false)} hideTopBackLink />
  );
}

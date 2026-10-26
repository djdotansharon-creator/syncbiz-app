"use client";

import { useEffect } from "react";

/**
 * No hover tooltips anywhere (owner 2026-10-26: "remove from the whole site, the player, everything: when I stand on something a little window with an explanation appears next to
 * the mouse"). Those boxes are the browser's native `title` tooltips. Rather than touching hundreds of components, every `title` attribute that appears in the page is taken off at once
 * and — so that screen readers still get a name — kept as `aria-label` when the element has no other name. Nothing else about the element changes.
 */
const SKIP = new Set(["IFRAME", "FRAME", "LINK", "STYLE", "META", "HTML", "SCRIPT"]);

function strip(el: Element): void {
  if (SKIP.has(el.tagName)) return;
  const t = el.getAttribute("title");
  if (t === null) return;
  if (t.trim() && !el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby") && !(el.textContent ?? "").trim()) el.setAttribute("aria-label", t);
  el.removeAttribute("title");
}

export function NoNativeTooltips(): null {
  useEffect(() => {
    document.querySelectorAll("[title]").forEach(strip);
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "attributes") {
          strip(r.target as Element);
        } else {
          r.addedNodes.forEach((n) => {
            if (n.nodeType !== 1) return;
            strip(n as Element);
            (n as Element).querySelectorAll?.("[title]").forEach(strip);
          });
        }
      }
    });
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
    return () => mo.disconnect();
  }, []);
  return null;
}

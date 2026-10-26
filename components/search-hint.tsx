"use client";

/**
 * SearchHint — the search field's resting state (owner 2026-10-18): a magnifier with ONE word beside it, centred in the
 * field. Cycle: the word's letters rise → hold → fall, and AS they fall the magnifier alone glides back to the centre → a
 * short beat → the next word's letters rise where they stand while the magnifier glides aside again. The pair is centred
 * at every rest point, and the WORD NEVER MOVES SIDEWAYS (v3: icon and word are positioned independently from the field's
 * centre; before, both rode one centred group and the falling word drifted right with the icon). Focus (or text) → the
 * word fades and the magnifier travels to the field's start; leaving the field → it glides back to the centre and a beat
 * later the first word rises. Pure overlay (pointer-events: none). Styles: `.sb-sh*` in globals.css.
 * (Earlier variants: design/search-hint.before-round10b.tsx.bak, design/search-hint.before-round10d.tsx.bak.)
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RiseText } from "@/components/rise-text";

type Phase = "show" | "fall" | "empty";
const ICON = 17;
const GAP = 11;

export function SearchHint({ words, rest }: { words: string[]; rest: boolean }) {
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<Phase>("show");
  const rootRef = useRef<HTMLSpanElement>(null);
  const iconRef = useRef<SVGSVGElement>(null);
  const wordRef = useRef<HTMLSpanElement>(null);
  const emptyWait = useRef(260); // how long the icon rests alone at the centre before the next word

  // positions, straight on the DOM (no per-frame re-render): the icon's transform is transitioned by CSS, the word's is instant
  useLayoutEffect(() => {
    const icon = iconRef.current;
    if (!icon) return;
    const word = wordRef.current;
    // owner 2026-10-20: in a right-to-left interface the magnifier sits at the RIGHT of the word and travels to the RIGHT edge on focus — everything is mirrored
    // (CSS anchors the icon / word from the right in `[dir=rtl]`, so the same offsets just change sign)
    const sg = rootRef.current && getComputedStyle(rootRef.current).direction === "rtl" ? -1 : 1;
    if (rest) {
      icon.style.transform = "translateX(0px)";
    } else if (phase === "show" && word) {
      const total = ICON + GAP + word.offsetWidth;
      icon.style.transform = `translateX(${sg * (-total / 2)}px)`;
      word.style.transform = `translateX(${sg * (-total / 2 + ICON + GAP)}px)`;
    } else {
      icon.style.transform = `translateX(${sg * (-ICON / 2)}px)`; // falling / between words: the icon alone, centred
    }
  }, [i, rest, phase, words]);

  // the field is open → once the word has faded, forget it; on leaving, the icon travels back before the first word
  useEffect(() => {
    if (!rest) return;
    emptyWait.current = 820;
    const t = window.setTimeout(() => setPhase("empty"), 300);
    return () => window.clearTimeout(t);
  }, [rest]);

  // rise → hold → fall → (icon alone at the centre) → next word
  useEffect(() => {
    if (rest || words.length === 0) return;
    const wait = phase === "show" ? 2400 : phase === "fall" ? 620 : emptyWait.current;
    const t = window.setTimeout(() => {
      if (phase === "show") setPhase("fall");
      else if (phase === "fall") setPhase("empty");
      else {
        emptyWait.current = 260;
        setI((n) => (n + 1) % words.length);
        setPhase("show");
      }
    }, wait);
    return () => window.clearTimeout(t);
  }, [rest, phase, i, words.length]);

  const word = words[i % Math.max(1, words.length)] ?? "";
  return (
    <span ref={rootRef} className="sb-sh" data-rest={rest ? "1" : "0"} aria-hidden>
      <svg ref={iconRef} className="sb-sh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      {phase === "empty" ? null : (
        <span ref={wordRef} className={`sb-sh-word${phase === "fall" ? " is-out" : ""}`} dir="auto">
          <RiseText key={`${i}:${word}`} text={word} step={38} delay={0} />
        </span>
      )}
    </span>
  );
}

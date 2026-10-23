"use client";

import type { CSSProperties } from "react";

const RTL_CH = /[֐-׿؀-ۿ]/;
const STRONG_CH = /[A-Za-z֐-׿؀-ۿ]/;

type Run = { dir: "ltr" | "rtl"; tokens: string[] };

/** The direction a line of text reads in — that of its FIRST strong letter (undefined when it has none). `dir="auto"` cannot be used on a heading made of
 *  RiseText: the runs inside carry their own `dir`, which the browser skips, so it would always read the heading as left-to-right. */
export function textDir(text: string | null | undefined): "ltr" | "rtl" | undefined {
  const m = text ? STRONG_CH.exec(text) : null;
  return m ? (RTL_CH.test(m[0]) ? "rtl" : "ltr") : undefined;
}

/** Group the words into runs of the same direction (neutral words/spaces stick to the run before them; leading neutrals join
 *  the first run) — so an English phrase inside a Hebrew line keeps its own left-to-right order, and the runs themselves
 *  follow the surrounding block's direction — exactly as the browser would lay out the same text unsplit. */
function toRuns(text: string): Run[] {
  const runs: Run[] = [];
  let lead: string[] = [];
  for (const tok of text.split(/(\s+)/)) {
    if (!tok) continue;
    const isSpace = /^\s+$/.test(tok);
    const d = !isSpace && STRONG_CH.test(tok) ? (RTL_CH.test(tok) ? "rtl" : "ltr") : null;
    const last = runs[runs.length - 1];
    if (!last) {
      if (!d) lead.push(tok);
      else {
        runs.push({ dir: d, tokens: [...lead, tok] });
        lead = [];
      }
    } else if (d && d !== last.dir) runs.push({ dir: d, tokens: [tok] });
    else last.tokens.push(tok);
  }
  if (runs.length === 0 && lead.length) runs.push({ dir: "ltr", tokens: lead });
  return runs;
}

/** A heading that rises letter by letter from below its own baseline (owner 2026-10-18). Words stay whole (no mid-word
 *  wrap); each letter is clipped by its word's line box and slides up on a short stagger. Every letter is its own
 *  inline-block, so the browser can't reorder Hebrew/Arabic by itself: the direction of each same-direction run is set explicitly (the line itself inherits the block's direction). Styles: `.sb-rise*` (globals.css). */
export function RiseText({ text, step = 26, delay = 140 }: { text: string; step?: number; delay?: number }) {
  let n = 0;
  // long strings stagger tighter so the whole line is in within ~0.9s
  const eff = Math.min(step, 900 / Math.max(1, Array.from(text).length));
  return (
    <span className="sb-rise" aria-label={text} style={{ ["--rd" as string]: `${delay}ms` } as CSSProperties}>
      {toRuns(text).map((run, ri) => {
        // whitespace at the END of a run belongs between the runs (in the block's own flow) — inside an RTL run it would be drawn at
        // the run's visual LEFT end and push the whole title a few px off the line of the artist / info below it
        let end = run.tokens.length;
        while (end > 0 && /^\s+$/.test(run.tokens[end - 1]!)) end--;
        const toks = run.tokens.slice(0, end);
        const gap = run.tokens.length > end;
        return (
        <span key={ri}>
        <span dir={run.dir} aria-hidden>
          {toks.map((tok, ti) =>
            /^\s+$/.test(tok) ? (
              <span key={ti}> </span>
            ) : (
              <span key={ti} className="sb-rise-w">
                {Array.from(tok).map((ch, ci) => (
                  <span key={ci} className="sb-rise-l" style={{ ["--i" as string]: Math.round(n++ * eff) } as CSSProperties}>
                    {ch}
                  </span>
                ))}
              </span>
            ),
          )}
        </span>
        {gap ? <span aria-hidden> </span> : null}
        </span>
        );
      })}
    </span>
  );
}

"use client";

import { useState, useEffect } from "react";
import { getMixDuration, setMixDuration, MIX_DURATIONS } from "@/lib/mix-preferences";
import { useTr } from "@/lib/i18n/use-tr";

/** Mix/crossfade duration (3/6/9/12s). Applies to all source transitions on MASTER playback. */
export function MixDurationSetting() {
  const tr = useTr();
  const [value, setValue] = useState<number>(6);

  useEffect(() => {
    setValue(getMixDuration());
  }, []);

  const handleChange = (seconds: number) => {
    setValue(seconds);
    setMixDuration(seconds as (typeof MIX_DURATIONS)[number]);
  };

  return (
    <div className="flex flex-wrap gap-2.5 sm:gap-3">
      {MIX_DURATIONS.map((sec) => (
        <button
          key={sec}
          type="button"
          onClick={() => handleChange(sec)}
          className={`flex min-h-[44px] min-w-[56px] items-center justify-center rounded-lg border px-4 py-2.5 text-sm font-bold tabular-nums transition-all sm:min-h-[48px] sm:min-w-[60px] ${
            value === sec
              ? "border-cyan-500/50 bg-cyan-500/12 text-cyan-300"
              : "border-slate-700/50 bg-slate-800/30 text-slate-400 hover:border-slate-600/60 hover:bg-slate-700/40 hover:text-slate-200"
          }`}
          title={tr("{n}s crossfade", { n: sec })}
          aria-pressed={value === sec}
          aria-label={tr("{n} seconds", { n: sec })}
        >
          {tr("{n}s", { n: sec })}
        </button>
      ))}
    </div>
  );
}

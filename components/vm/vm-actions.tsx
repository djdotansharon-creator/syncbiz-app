"use client";

import type { ReactNode } from "react";
import { useTr } from "@/lib/i18n/use-tr";
import { useVmUi } from "@/components/vm/vm-ui";
import { VmCover } from "@/components/vm/vm-parts";

/**
 * A ROW'S MENU (owner 2026-11-17: "instead of the play / pause button put three dots — the details are there, like in general; and tapping the song just plays it").
 * One bottom sheet for every song / playlist / search result: who it is (cover, title, what kind), what can be done with it (frameless rows), and its details.
 * It is opened through the shell (`ui.openSheet`), so a list of 60 rows mounts no sheet of its own.
 */
export type VmActionSpec = {
  cover: string | null;
  title: string;
  /** one short line under the title ("Song", "8 songs") */
  sub?: string;
  actions: { key: string; icon: ReactNode; label: string; run: () => void; disabled?: boolean }[];
  /** label / value pairs; only what is known is listed */
  details?: { label: string; value: string }[];
};

function VmActions({ spec }: { spec: VmActionSpec }) {
  const ui = useVmUi();
  const tr = useTr();
  return (
    <div className="vm-act">
      <div className="vm-act-head">
        <VmCover src={spec.cover} name={spec.title} size={60} radius={14} />
        <div className="vm-act-id">
          <div className="vm-act-title vm-bdi">{spec.title}</div>
          {spec.sub ? <div className="vm-act-sub vm-bdi">{spec.sub}</div> : null}
        </div>
      </div>
      <div className="vm-act-list">
        {spec.actions.map((a) => (
          <button
            key={a.key}
            type="button"
            className="vm-act-row"
            disabled={a.disabled}
            onClick={() => {
              ui.closeSheet();
              a.run();
            }}
          >
            {a.icon}
            <span>{a.label}</span>
          </button>
        ))}
      </div>
      {spec.details?.length ? (
        <div className="vm-act-details">
          <div className="vm-sec" style={{ margin: "6px 0 6px" }}>{tr("Details")}</div>
          {spec.details.map((d) => (
            <div key={d.label} className="vm-act-kv">
              <span>{d.label}</span>
              <b className="vm-bdi">{d.value}</b>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** opens a row's menu: `const open = useOpenActions(); open({ … })` */
export function useOpenActions(): (spec: VmActionSpec) => void {
  const ui = useVmUi();
  return (spec) => ui.openSheet(spec.title, <VmActions spec={spec} />);
}

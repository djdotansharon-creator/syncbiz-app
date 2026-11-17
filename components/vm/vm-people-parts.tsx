"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useTr } from "@/lib/i18n/use-tr";
import { useVmUi } from "@/components/vm/vm-ui";
import { IconChevronBack } from "@/components/vm/vm-icons";
import type { PersonRow } from "@/lib/mobile-people";

type Tr = (text: string, vars?: Record<string, string | number>) => string;

/** "Last sign-in" in the words the computer's Permissions screen uses */
export function agoLabel(iso: string | null, tr: Tr): string {
  if (!iso) return tr("Never signed in");
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 2) return tr("Just now");
  if (min < 60) return tr("{n} min ago", { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return tr("{n} h ago", { n: h });
  return tr("{n} days ago", { n: Math.round(h / 24) });
}

/** the level in words ("Owner" / "Manager" / "Member") */
export function levelLabel(level: PersonRow["level"], tr: Tr): string {
  return tr(level === "owner" ? "Owner" : level === "manager" ? "Manager" : "Member");
}

/** the state in words — what a person's row says under the name */
export function stateLabel(status: PersonRow["status"], tr: Tr): string {
  return tr(status === "active" ? "Active" : status === "paused" ? "Paused" : "Sign-in off");
}

/** the back button of the people screens: one step back where the person came from (the branch's people, the list…), or to `fallback` when there is no history (a link opened cold) */
export function VmBack({ fallback, label }: { fallback: string; label: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="vm-icobtn vm-back"
      aria-label={label}
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) router.back();
        else router.push(fallback);
      }}
    >
      <IconChevronBack />
      <span>{label}</span>
    </button>
  );
}

/** a question in the bottom sheet before something that cannot be undone: the thing in words, a red button, a way out */
export function ConfirmBody({ title, text, confirmLabel, cancelLabel, onConfirm, onCancel }: { title: string; text: string; confirmLabel: string; cancelLabel: string; onConfirm: () => void; onCancel: () => void }): ReactNode {
  return (
    <div className="vm-ask">
      <h2 className="vm-bdi">{title}</h2>
      <p className="vm-bdi">{text}</p>
      <button type="button" className="vm-ask-btn" data-danger="" onClick={onConfirm}>{confirmLabel}</button>
      <button type="button" className="vm-ask-btn" onClick={onCancel}>{cancelLabel}</button>
    </div>
  );
}

/** opens the question above in the shell's bottom sheet */
export function useAsk(): (spec: { title: string; text: string; confirmLabel: string; onConfirm: () => void }) => void {
  const ui = useVmUi();
  const tr = useTr();
  return (spec) =>
    ui.openSheet(
      spec.title,
      <ConfirmBody
        title={spec.title}
        text={spec.text}
        confirmLabel={spec.confirmLabel}
        cancelLabel={tr("Cancel")}
        onConfirm={() => {
          ui.closeSheet();
          spec.onConfirm();
        }}
        onCancel={ui.closeSheet}
      />,
    );
}

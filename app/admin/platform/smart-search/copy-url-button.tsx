"use client";

import { useState } from "react";

export function SmartSearchCopyUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="rounded border border-neutral-600 bg-neutral-900 px-2 py-1 text-[11px] font-medium text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copied" : "Copy URL"}
    </button>
  );
}

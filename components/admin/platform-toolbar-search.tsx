"use client";

/**
 * Small GET form for `/admin/platform` and `/admin/platform/users`:
 * updates `?q=` without extra JS navigation (no backend change).
 */

import Link from "next/link";

type Props = {
  actionPath: "/admin/platform" | "/admin/platform/users";
  placeholder: string;
  /** Current `q` value from the server (controlled default). */
  initialQ: string;
  /** When true (users page + orphan filter), submits preserve `filter=orphan`. */
  preserveOrphanFilter?: boolean;
};

export default function PlatformToolbarSearch({
  actionPath,
  placeholder,
  initialQ,
  preserveOrphanFilter,
}: Props) {
  const hasActiveSearch = initialQ.trim().length > 0;

  const clearHref =
    preserveOrphanFilter === true
      ? `${actionPath}?filter=orphan`
      : actionPath;

  return (
    <form action={actionPath} method="get" className="flex flex-wrap items-center gap-2">
      {preserveOrphanFilter ? <input type="hidden" name="filter" value="orphan" /> : null}
      <label className="sr-only" htmlFor={`platform-search-${actionPath.replace(/\//g, "-")}`}>
        Search
      </label>
      <input
        id={`platform-search-${actionPath.replace(/\//g, "-")}`}
        name="q"
        type="search"
        autoComplete="off"
        defaultValue={initialQ}
        placeholder={placeholder}
        className="w-[min(100%,220px)] rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-[12px] text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
      />
      <button
        type="submit"
        className="rounded border border-neutral-600 bg-neutral-900 px-2 py-1 text-[12px] font-medium text-neutral-200 hover:bg-neutral-800"
      >
        Search
      </button>
      {hasActiveSearch ? (
        <Link
          href={clearHref}
          className="rounded border border-transparent px-2 py-1 text-[12px] text-neutral-400 hover:text-neutral-200"
        >
          Clear
        </Link>
      ) : null}
    </form>
  );
}

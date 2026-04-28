"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type MusicTaxonomyTagDTO = {
  id: string;
  slug: string;
  category: string;
  labelEn: string;
  labelHe: string;
  descriptionHeUser: string | null;
  descriptionAi: string | null;
  aliases: string[];
  status: string;
  parentId: string | null;
  mergedIntoId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  parent: { id: string; slug: string; labelEn: string } | null;
  mergedInto: { id: string; slug: string; labelEn: string } | null;
};

const CATEGORIES = [
  "PLAYBACK_CONTEXT",
  "VIBE_ENERGY",
  "MAIN_SOUND_GENRE",
  "STYLE_TAGS",
  "ISRAELI_SPECIALS",
  "TECHNICAL_TAGS",
  "BUSINESS_FIT",
  "DAYPART_FIT",
] as const;

const STATUSES = ["ACTIVE", "DEPRECATED", "HIDDEN", "MERGED"] as const;

export default function MusicTaxonomyTagsPanel({
  displayedTags,
  catalogTags,
}: {
  displayedTags: MusicTaxonomyTagDTO[];
  catalogTags: MusicTaxonomyTagDTO[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<MusicTaxonomyTagDTO | null>(null);
  const [creating, setCreating] = useState(false);

  const mergeChoices = useMemo(
    () =>
      catalogTags.filter((t) => t.status === "ACTIVE" || t.status === "DEPRECATED"),
    [catalogTags],
  );

  async function patchTag(id: string, body: Record<string, unknown>): Promise<boolean> {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/platform/music-taxonomy/tags/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : res.statusText);
        return false;
      }
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function createTag(payload: Record<string, unknown>) {
    setBusyId("_create");
    setError(null);
    try {
      const res = await fetch("/api/admin/platform/music-taxonomy/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : res.statusText);
        return;
      }
      setCreating(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusyId(null);
    }
  }

  async function saveEditor(formData: FormData) {
    if (!editor) return;
    const aliasesRaw = String(formData.get("aliases") ?? "")
      .split(/[,;\n]/u)
      .map((s) => s.trim())
      .filter(Boolean);

    const payload = {
      category: formData.get("category"),
      labelEn: formData.get("labelEn"),
      labelHe: formData.get("labelHe"),
      descriptionHeUser:
        formData.get("descriptionHeUser") === "" ? null : String(formData.get("descriptionHeUser")),
      descriptionAi:
        formData.get("descriptionAi") === "" ? null : String(formData.get("descriptionAi")),
      aliases: aliasesRaw,
      status: formData.get("status"),
      sortOrder: Number(formData.get("sortOrder")),
      parentId:
        formData.get("parentId") === "" ? null : String(formData.get("parentId")),
      mergedIntoId:
        formData.get("mergedIntoId") === "" ? null : String(formData.get("mergedIntoId")),
    };

    const ok = await patchTag(editor.id, payload);
    if (ok) setEditor(null);
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded border border-rose-900/80 bg-rose-950/40 px-3 py-2 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setCreating(true);
            setError(null);
          }}
          className="rounded border border-emerald-700 bg-emerald-950/40 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-900/50"
        >
          New tag
        </button>
        <span className="text-xs text-neutral-500">{displayedTags.length} tag(s) shown</span>
      </div>

      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="min-w-full divide-y divide-neutral-800 text-sm">
          <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="px-3 py-2 font-medium">Slug</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">English</th>
              <th className="px-3 py-2 font-medium">Hebrew</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Sort</th>
              <th className="px-3 py-2 font-medium">Links</th>
              <th className="px-3 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {displayedTags.map((t) => (
              <tr key={t.id} className="hover:bg-neutral-900/40">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-neutral-200">{t.slug}</td>
                <td className="px-3 py-2 text-neutral-300">{t.category}</td>
                <td className="max-w-[160px] truncate px-3 py-2 text-neutral-200">{t.labelEn}</td>
                <td className="max-w-[160px] truncate px-3 py-2 text-neutral-200">{t.labelHe}</td>
                <td className="px-3 py-2">
                  <span
                    className={
                      t.status === "ACTIVE"
                        ? "rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-200 ring-1 ring-emerald-500/30"
                        : t.status === "MERGED"
                          ? "rounded bg-violet-500/15 px-1.5 py-0.5 text-xs text-violet-200 ring-1 ring-violet-500/30"
                          : "rounded bg-neutral-600/25 px-1.5 py-0.5 text-xs text-neutral-300 ring-1 ring-neutral-600/40"
                    }
                  >
                    {t.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-neutral-400">{t.sortOrder}</td>
                <td className="max-w-[180px] px-3 py-2 text-xs text-neutral-500">
                  {t.parent ? (
                    <span className="block truncate">↑ {t.parent.slug}</span>
                  ) : null}
                  {t.mergedInto ? (
                    <span className="block truncate">→ {t.mergedInto.slug}</span>
                  ) : null}
                  {!t.parent && !t.mergedInto ? "—" : null}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => setEditor(t)}
                    className="mr-2 rounded border border-neutral-700 px-2 py-1 text-neutral-200 hover:bg-neutral-800 disabled:opacity-40"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busyId !== null || t.status !== "ACTIVE"}
                    onClick={() => patchTag(t.id, { status: "DEPRECATED" })}
                    className="mr-2 rounded border border-amber-800 px-2 py-1 text-amber-100 hover:bg-amber-950/40 disabled:opacity-40"
                  >
                    Deprecate
                  </button>
                  <button
                    type="button"
                    disabled={busyId !== null || t.status === "HIDDEN"}
                    onClick={() => patchTag(t.id, { status: "HIDDEN" })}
                    className="mr-2 rounded border border-neutral-700 px-2 py-1 text-neutral-200 hover:bg-neutral-800 disabled:opacity-40"
                  >
                    Hide
                  </button>
                  <MergeIntoButton
                    choices={mergeChoices.filter((c) => c.id !== t.id)}
                    disabled={busyId !== null}
                    onMerge={(mergedIntoId) => patchTag(t.id, { status: "MERGED", mergedIntoId })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating ? (
        <TagEditorModal
          title="Create tag"
          busy={busyId === "_create"}
          initial={null}
          tagChoices={catalogTags.filter((c) => c.status !== "MERGED")}
          onCancel={() => setCreating(false)}
          onSave={(fd) => createTag(formDataToCreate(fd))}
        />
      ) : null}

      {editor ? (
        <TagEditorModal
          title={`Edit · ${editor.slug}`}
          busy={busyId === editor.id}
          initial={editor}
          tagChoices={catalogTags.filter((c) => c.id !== editor.id && c.status !== "MERGED")}
          onCancel={() => setEditor(null)}
          onSave={(fd) => saveEditor(fd)}
        />
      ) : null}
    </div>
  );
}

function formDataToCreate(fd: FormData): Record<string, unknown> {
  const aliasesRaw = String(fd.get("aliases") ?? "")
    .split(/[,;\n]/u)
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    slug: String(fd.get("slug") ?? "").trim(),
    category: fd.get("category"),
    labelEn: String(fd.get("labelEn") ?? "").trim(),
    labelHe: String(fd.get("labelHe") ?? "").trim(),
    descriptionHeUser:
      fd.get("descriptionHeUser") === "" ? null : String(fd.get("descriptionHeUser")),
    descriptionAi: fd.get("descriptionAi") === "" ? null : String(fd.get("descriptionAi")),
    aliases: aliasesRaw,
    status: fd.get("status"),
    sortOrder: Number(fd.get("sortOrder")),
    parentId: fd.get("parentId") === "" ? null : String(fd.get("parentId")),
    mergedIntoId: fd.get("mergedIntoId") === "" ? null : String(fd.get("mergedIntoId")),
  };
}

function MergeIntoButton({
  choices,
  disabled,
  onMerge,
}: {
  choices: MusicTaxonomyTagDTO[];
  disabled: boolean;
  onMerge: (mergedIntoId: string) => void;
}) {
  const [pick, setPick] = useState("");
  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        className="max-w-[140px] rounded border border-neutral-700 bg-neutral-950 px-1 py-1 text-[11px] text-neutral-200"
      >
        <option value="">Merge into…</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.slug}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={disabled || !pick}
        onClick={() => pick && onMerge(pick)}
        className="rounded border border-violet-800 px-2 py-1 text-violet-100 hover:bg-violet-950/40 disabled:opacity-40"
      >
        Merge
      </button>
    </span>
  );
}

function TagEditorModal({
  title,
  busy,
  initial,
  tagChoices,
  onCancel,
  onSave,
}: {
  title: string;
  busy: boolean;
  initial: MusicTaxonomyTagDTO | null;
  tagChoices: MusicTaxonomyTagDTO[];
  onCancel: () => void;
  onSave: (fd: FormData) => void | Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-[2px]">
      <div className="mt-8 w-full max-w-lg rounded-lg border border-neutral-800 bg-neutral-950 p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-neutral-50">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
          >
            Close
          </button>
        </div>

        <form
          className="space-y-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            void onSave(fd);
          }}
        >
          {!initial ? (
            <label className="block space-y-1">
              <span className="text-xs text-neutral-500">Slug</span>
              <input
                name="slug"
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-neutral-100"
                placeholder="style-example-tag"
              />
            </label>
          ) : null}

          <label className="block space-y-1">
            <span className="text-xs text-neutral-500">Category</span>
            <select
              name="category"
              required
              defaultValue={initial?.category ?? "PLAYBACK_CONTEXT"}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs text-neutral-500">English label</span>
              <input
                name="labelEn"
                required
                defaultValue={initial?.labelEn ?? ""}
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-neutral-500">Hebrew label</span>
              <input
                name="labelHe"
                required
                defaultValue={initial?.labelHe ?? ""}
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs text-neutral-500">Description (Hebrew, user-facing)</span>
            <textarea
              name="descriptionHeUser"
              rows={3}
              defaultValue={initial?.descriptionHeUser ?? ""}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-neutral-500">Description (AI / internal)</span>
            <textarea
              name="descriptionAi"
              rows={2}
              defaultValue={initial?.descriptionAi ?? ""}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-neutral-500">Aliases (comma / newline separated)</span>
            <textarea
              name="aliases"
              rows={2}
              defaultValue={initial?.aliases.join(", ") ?? ""}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-[11px] text-neutral-100"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs text-neutral-500">Status</span>
              <select
                name="status"
                required
                defaultValue={initial?.status ?? "ACTIVE"}
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-neutral-500">Sort order</span>
              <input
                name="sortOrder"
                type="number"
                required
                defaultValue={initial?.sortOrder ?? 0}
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs text-neutral-500">Parent tag</span>
            <select
              name="parentId"
              defaultValue={initial?.parentId ?? ""}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
            >
              <option value="">None</option>
              {tagChoices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.slug} — {c.labelEn}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-neutral-500">Merged into (canonical)</span>
            <select
              name="mergedIntoId"
              defaultValue={initial?.mergedIntoId ?? ""}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
            >
              <option value="">None</option>
              {tagChoices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.slug} — {c.labelEn}
                </option>
              ))}
            </select>
          </label>

          <p className="text-[11px] text-neutral-500">
            Setting status to MERGED requires a merged-into target. Parent links cannot create cycles.
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-sky-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-600 disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

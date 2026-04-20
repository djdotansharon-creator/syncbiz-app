"use client";

/**
 * Thin page wrapper for `/playlists/[id]/edit`. All field UI + fetch/save
 * logic lives in `<EditPlaylistForm />` so it can be reused inline inside
 * the library center workspace panel (player's Edit action).
 */

import { useRouter, useParams, useSearchParams } from "next/navigation";
import { EditPlaylistForm } from "@/components/edit-playlist-form";

export default function EditPlaylistPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const returnTo = searchParams.get("return") || "/playlists";

  return (
    <EditPlaylistForm
      id={id}
      backHref={returnTo}
      onDone={() => {
        router.push(returnTo);
        router.refresh();
      }}
      onCancel={() => router.push(returnTo)}
    />
  );
}

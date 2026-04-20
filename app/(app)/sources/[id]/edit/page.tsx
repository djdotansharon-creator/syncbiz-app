"use client";

/**
 * Thin page wrapper for `/sources/[id]/edit`. All field UI + fetch/save
 * logic lives in `<EditSourceForm />` so it can be reused inline inside
 * the library center workspace panel (player's Edit action).
 */

import { useRouter, useParams, useSearchParams } from "next/navigation";
import { EditSourceForm } from "@/components/edit-source-form";

export default function EditSourcePage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const returnTo = searchParams.get("return") || "/sources";

  return (
    <EditSourceForm
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

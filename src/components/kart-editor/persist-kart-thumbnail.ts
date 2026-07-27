"use client";

import type { PersistedKartRevision } from "@/game/kart/kart-publication";
import { createKartThumbnailUpload } from "@/game/kart/kart-thumbnail-renderer";

export async function persistKartRevisionThumbnail(
  revision: PersistedKartRevision,
) {
  if (revision.thumbnailAvailable) return revision;
  try {
    const upload = await createKartThumbnailUpload(revision.document);
    const response = await fetch(
      `/api/admin/karts/${revision.kartId}/revisions/${revision.revision}/thumbnail`,
      {
        body: JSON.stringify(upload),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "PUT",
        signal: AbortSignal.timeout(3_000),
      },
    );
    if (!response.ok && response.status !== 409) return revision;
    return { ...revision, thumbnailAvailable: true };
  } catch {
    return revision;
  }
}

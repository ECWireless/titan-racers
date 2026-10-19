"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import type { KartAssemblyDocument } from "@/game/kart/kart-assembly-document";
import {
  KartThumbnailRenderingPausedError,
  renderKartThumbnail,
} from "@/game/kart/kart-thumbnail-renderer";

export function KartThumbnail({
  document,
  initialized,
  pending = false,
  source,
}: {
  document: KartAssemblyDocument;
  initialized: boolean;
  /** The caller is still resolving which revision to show. */
  pending?: boolean;
  source: string | null;
}) {
  const renderKey = useMemo(() => JSON.stringify(document), [document]);
  const [generated, setGenerated] = useState<{
    key: string;
    source: string;
  } | null>(null);
  const [failedRemoteSource, setFailedRemoteSource] = useState<string | null>(
    null,
  );
  const [failedRenderKey, setFailedRenderKey] = useState<string | null>(null);
  const remoteFailed = source !== null && failedRemoteSource === source;
  const generatedSource =
    generated?.key === renderKey ? generated.source : null;
  const renderFailed = failedRenderKey === renderKey;

  useEffect(() => {
    if (!initialized || (source && !remoteFailed)) return;
    let active = true;
    let objectUrl: string | null = null;
    void renderKartThumbnail(document)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setGenerated({ key: renderKey, source: objectUrl });
      })
      .catch((error) => {
        if (error instanceof KartThumbnailRenderingPausedError) return;
        console.error("Unable to render kart thumbnail", error);
        if (active) setFailedRenderKey(renderKey);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [document, initialized, remoteFailed, renderKey, source]);

  const imageSource =
    source && !remoteFailed ? source : generatedSource ?? null;
  const imageKind =
    source && !remoteFailed
      ? "persisted"
      : generatedSource
        ? "generated"
        : pending
          ? "loading"
          : initialized && !renderFailed
            ? "rendering"
            : "placeholder";

  return (
    <div
      className="relative aspect-video overflow-hidden border border-titan-ice/14 bg-[radial-gradient(circle_at_50%_28%,rgb(68_82_94/0.42),rgb(9_11_12)_72%)]"
      data-kart-thumbnail-source={imageKind}
    >
      {imageSource ? (
        <Image
          alt={`${document.name} assembly`}
          className="object-cover"
          fill
          sizes="(min-width: 1024px) 28vw, (min-width: 768px) 32vw, 100vw"
          src={imageSource}
          unoptimized
          onError={() => {
            if (imageSource === source) setFailedRemoteSource(source);
            else setFailedRenderKey(renderKey);
          }}
        />
      ) : imageKind === "loading" || imageKind === "rendering" ? (
        <div
          aria-label={`${document.name} thumbnail loading`}
          className="absolute inset-0 bg-titan-ice/[0.04] motion-safe:animate-pulse"
          role="img"
        />
      ) : (
        <div
          aria-label={`${document.name} thumbnail ${
            initialized ? "unavailable" : "not yet saved"
          }`}
          className="absolute inset-0 grid place-items-center px-5 text-center font-mono text-[0.62rem] font-bold uppercase tracking-[0.14em] text-titan-muted"
          role="img"
        >
          {initialized ? "Thumbnail unavailable" : "No saved design"}
        </div>
      )}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-titan-hazard/65 to-transparent"
      />
    </div>
  );
}

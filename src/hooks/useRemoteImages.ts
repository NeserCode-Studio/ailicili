import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

const BILIBILI_ORIGIN = "https://www.bilibili.com";
const BILIBILI_REFERER = `${BILIBILI_ORIGIN}/`;
const BILIBILI_IMAGE_HOST_SUFFIXES = [
  "bilibili.com",
  "biliimg.com",
  "bilivideo.com",
  "hdslb.com",
];
const IMAGE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";

function imageRequestHeaders(source: string) {
  const headers: Record<string, string> = {
    Accept: IMAGE_ACCEPT,
    "User-Agent": IMAGE_USER_AGENT,
  };
  try {
    const host = new URL(source).hostname.toLowerCase();
    if (
      BILIBILI_IMAGE_HOST_SUFFIXES.some(
        (suffix) => host === suffix || host.endsWith(`.${suffix}`)
      )
    ) {
      headers.Origin = BILIBILI_ORIGIN;
      headers.Referer = BILIBILI_REFERER;
    }
  } catch {
    return headers;
  }
  return headers;
}

async function fetchImageObjectUrl(source: string) {
  const response = await tauriFetch(source, {
    method: "GET",
    headers: imageRequestHeaders(source),
  });
  if (!response.ok) {
    throw new Error(`image request failed with status ${response.status}`);
  }
  const blob = await response.blob();
  if (blob.type && !blob.type.startsWith("image/")) {
    throw new Error(`unexpected image content type: ${blob.type}`);
  }
  return URL.createObjectURL(blob);
}

export function useRemoteImage(source?: string) {
  const [resolvedSource, setResolvedSource] = useState<string>();
  const [loading, setLoading] = useState(Boolean(source));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!source) {
      setResolvedSource(undefined);
      setLoading(false);
      setFailed(false);
      return;
    }

    if (!isTauri()) {
      setResolvedSource(source);
      setLoading(false);
      setFailed(false);
      return;
    }

    let cancelled = false;
    let objectUrl: string | undefined;
    setResolvedSource(undefined);
    setLoading(true);
    setFailed(false);

    void fetchImageObjectUrl(source)
      .then((url) => {
        objectUrl = url;
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setResolvedSource(url);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source]);

  return { src: resolvedSource, loading, failed };
}

interface RemoteImagesOptions {
  enabled?: boolean;
}

export function useRemoteImages(
  sources: readonly string[],
  { enabled = true }: RemoteImagesOptions = {}
) {
  const sourceKey = sources.join("\n");
  const [resolvedSources, setResolvedSources] = useState<
    Record<string, string>
  >({});
  const [failedSources, setFailedSources] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  useEffect(() => {
    const uniqueSources = sourceKey ? [...new Set(sourceKey.split("\n"))] : [];
    const objectUrls: string[] = [];
    let cancelled = false;

    setResolvedSources({});
    setFailedSources(new Set());
    if (!enabled) return;
    if (uniqueSources.length === 0) return;

    if (!isTauri()) {
      setResolvedSources(
        Object.fromEntries(uniqueSources.map((source) => [source, source]))
      );
      return;
    }

    for (const source of uniqueSources) {
      void fetchImageObjectUrl(source)
        .then((url) => {
          objectUrls.push(url);
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          setResolvedSources((current) => ({ ...current, [source]: url }));
        })
        .catch(() => {
          if (cancelled) return;
          setFailedSources((current) => {
            const next = new Set(current);
            next.add(source);
            return next;
          });
        });
    }

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [enabled, sourceKey]);

  return { resolvedSources, failedSources };
}

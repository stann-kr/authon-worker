export interface UrlShareData {
  url: string;
}

export interface UrlShareAdapter {
  share?: (data: UrlShareData) => Promise<void>;
  canShare?: (data: UrlShareData) => boolean;
  copy: (url: string) => Promise<void>;
}

export type UrlShareResult = "shared" | "copied" | "cancelled" | "failed";

export function toUrlShareData(url: string): UrlShareData {
  return { url };
}

export function isUrlShareCancellation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/**
 * Keeps credential-bearing shares URL-only across native share and clipboard.
 */
export async function shareUrl(
  data: UrlShareData,
  adapter: UrlShareAdapter,
): Promise<UrlShareResult> {
  let canUseNativeShare = typeof adapter.share === "function";
  if (canUseNativeShare && adapter.canShare) {
    try {
      canUseNativeShare = adapter.canShare(data);
    } catch {
      canUseNativeShare = false;
    }
  }

  if (canUseNativeShare && adapter.share) {
    try {
      await adapter.share(data);
      return "shared";
    } catch (error: unknown) {
      if (isUrlShareCancellation(error)) return "cancelled";
    }
  }

  try {
    await adapter.copy(data.url);
    return "copied";
  } catch {
    return "failed";
  }
}

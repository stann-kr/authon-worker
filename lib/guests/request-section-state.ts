import type {
  Guest,
  GuestQuota,
  GuestWorkspaceSnapshot,
} from "@/lib/api/types";

export interface GuestWorkspaceDisplay {
  guests: Guest[];
  quota: GuestQuota | null;
}

export interface GuestLimitRequestDraft {
  requestedExtra: string;
  requestReason: string;
}

export const DEFAULT_GUEST_LIMIT_REQUEST_DRAFT: GuestLimitRequestDraft = {
  requestedExtra: "1",
  requestReason: "",
};

export type GuestLimitRequestSectionState =
  | "hidden"
  | "loading"
  | "available"
  | "pending"
  | "unavailable";

export function selectGuestWorkspaceDisplay({
  scopeKey,
  loadedScopeKey,
  liveDisplay,
  cache,
  preferCachedDisplay,
}: {
  scopeKey: string;
  loadedScopeKey: string;
  liveDisplay: GuestWorkspaceDisplay;
  cache: ReadonlyMap<string, GuestWorkspaceDisplay>;
  preferCachedDisplay: boolean;
}): GuestWorkspaceDisplay | null {
  const cachedDisplay = cache.get(scopeKey);

  if (loadedScopeKey !== scopeKey) {
    return cachedDisplay ?? null;
  }

  if (preferCachedDisplay && cachedDisplay) {
    return cachedDisplay;
  }

  return liveDisplay;
}

export function mergeGuestWorkspaceDisplay(
  previous: GuestWorkspaceDisplay | null,
  snapshot: GuestWorkspaceSnapshot,
): GuestWorkspaceDisplay {
  return {
    guests: snapshot.failedSections.includes("guests")
      ? (previous?.guests ?? [])
      : snapshot.guests,
    quota: snapshot.failedSections.includes("quota")
      ? (previous?.quota ?? null)
      : snapshot.quota,
  };
}

export function getScopedGuestLimitRequestDraft(
  drafts: Readonly<Record<string, GuestLimitRequestDraft>>,
  scopeKey: string,
): GuestLimitRequestDraft {
  return drafts[scopeKey] ?? DEFAULT_GUEST_LIMIT_REQUEST_DRAFT;
}

export function resetScopedGuestLimitRequestDraft(
  drafts: Readonly<Record<string, GuestLimitRequestDraft>>,
  scopeKey: string,
): Record<string, GuestLimitRequestDraft> {
  return {
    ...drafts,
    [scopeKey]: DEFAULT_GUEST_LIMIT_REQUEST_DRAFT,
  };
}

export function getGuestLimitRequestSectionState({
  isEligible,
  hasCurrentScopeData,
  canRequestExtra,
  hasPendingRequest,
}: {
  isEligible: boolean;
  hasCurrentScopeData: boolean;
  canRequestExtra: boolean;
  hasPendingRequest: boolean;
}): GuestLimitRequestSectionState {
  if (!isEligible) return "hidden";
  if (!hasCurrentScopeData) return "loading";
  if (hasPendingRequest) return "pending";
  return canRequestExtra ? "available" : "unavailable";
}

export function canSubmitGuestLimitRequest({
  sectionState,
  hasVerifiedQuota,
  isScopeFetching,
}: {
  sectionState: GuestLimitRequestSectionState;
  hasVerifiedQuota: boolean;
  isScopeFetching: boolean;
}): boolean {
  return sectionState === "available" && hasVerifiedQuota && !isScopeFetching;
}

export function canEditGuestLimitRequestDraft(
  sectionState: GuestLimitRequestSectionState,
): boolean {
  return sectionState === "available";
}

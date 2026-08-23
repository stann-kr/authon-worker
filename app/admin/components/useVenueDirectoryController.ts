"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useSectionLoadingTask } from "@/components/RouteTransitionProvider";
import { useLatestRequestGuard } from "@/lib/hooks";
import { deriveAsyncListState } from "@/lib/ui/async-list-state";
import type { Venue } from "@/lib/venues/types";

export type VenueUpdateInput = Partial<
  Pick<
    Venue,
    | "name"
    | "type"
    | "address"
    | "description"
    | "brandName"
    | "brandTagline"
    | "brandDescription"
    | "brandFooter"
    | "primaryDomain"
    | "defaultLocale"
    | "timezone"
    | "openingTime"
    | "closingTime"
    | "active"
  >
>;

export interface VenueDirectoryControllerDependencies {
  fetchVenues: (includeInactive?: boolean) => Promise<{
    data: Venue[] | null;
    error: string | null;
  }>;
  updateVenue: (
    id: string,
    updates: VenueUpdateInput,
  ) => Promise<{ data: Venue | null; error: string | null }>;
}

export type VenueMutationFallback = "createFailed" | "updateFailed";

export type VenueMutationMessageResolver = (
  error: string,
  fallback: VenueMutationFallback,
) => string;

export type VenueDirectoryMutationResult =
  | { status: "applied"; error: null }
  | { status: "failed"; error: string | null }
  | { status: "busy"; error: null };

export type VenueDirectoryLoadResult =
  | { status: "applied" }
  | { status: "failed" }
  | { status: "stale" };

const BUSY_MUTATION_RESULT: VenueDirectoryMutationResult = Object.freeze({
  status: "busy",
  error: null,
});
const APPLIED_LOAD_RESULT: VenueDirectoryLoadResult = Object.freeze({
  status: "applied",
});
const FAILED_LOAD_RESULT: VenueDirectoryLoadResult = Object.freeze({
  status: "failed",
});
const STALE_LOAD_RESULT: VenueDirectoryLoadResult = Object.freeze({
  status: "stale",
});

interface UseVenueDirectoryControllerOptions {
  dependencies: VenueDirectoryControllerDependencies;
  refreshActiveVenues: () => Promise<void>;
  resolveMutationMessage: VenueMutationMessageResolver;
}

export default function useVenueDirectoryController({
  dependencies,
  refreshActiveVenues,
  resolveMutationMessage,
}: UseVenueDirectoryControllerOptions) {
  const t = useTranslations("VenueAdmin");
  const [venues, setVenues] = useState<Venue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [loadOutcome, setLoadOutcome] = useState<
    "idle" | "success" | "partial" | "error"
  >("idle");
  const [isMutating, setIsMutating] = useState(false);
  const activeMutationOwnerRef = useRef<symbol | null>(null);
  const requestGuard = useLatestRequestGuard();
  useSectionLoadingTask(isLoading);

  const loadVenues = useCallback(async (): Promise<VenueDirectoryLoadResult> => {
    const isLatestRequest = requestGuard.beginRequest();
    setIsLoading(true);
    setListError("");
    try {
      const { data, error } = await dependencies.fetchVenues(true);
      if (!isLatestRequest()) return STALE_LOAD_RESULT;
      if (data) setVenues(data);
      if (error || data === null) {
        console.error("Failed to load venues:", error ?? "Missing venue data");
        setListError(t("loadFailed"));
        setLoadOutcome(data ? "partial" : "error");
        return FAILED_LOAD_RESULT;
      }
      setListError("");
      setLoadOutcome("success");
      return APPLIED_LOAD_RESULT;
    } catch (error: unknown) {
      if (!isLatestRequest()) return STALE_LOAD_RESULT;
      console.error("Failed to load venues:", error);
      setListError(t("loadFailed"));
      setLoadOutcome("error");
      return FAILED_LOAD_RESULT;
    } finally {
      if (isLatestRequest()) setIsLoading(false);
    }
  }, [dependencies, requestGuard, t]);

  useEffect(() => {
    loadVenues();
  }, [loadVenues]);

  const refreshAfterMutation = useCallback(async () => {
    const [directoryRefresh, activeVenueRefresh] = await Promise.allSettled([
      loadVenues(),
      (async () => refreshActiveVenues())(),
    ]);
    if (activeVenueRefresh.status === "rejected") {
      console.error(
        "Failed to refresh active venues:",
        activeVenueRefresh.reason,
      );
      return FAILED_LOAD_RESULT;
    }
    if (directoryRefresh.status === "rejected") {
      console.error("Failed to refresh venues:", directoryRefresh.reason);
      return FAILED_LOAD_RESULT;
    }
    return directoryRefresh.value;
  }, [loadVenues, refreshActiveVenues]);

  const claimMutation = useCallback(() => {
    if (activeMutationOwnerRef.current) return null;
    const owner = Symbol("venue-directory-mutation");
    activeMutationOwnerRef.current = owner;
    setIsMutating(true);
    return owner;
  }, []);

  const releaseMutation = useCallback((owner: symbol) => {
    if (activeMutationOwnerRef.current !== owner) return;
    activeMutationOwnerRef.current = null;
    setIsMutating(false);
  }, []);

  const handleToggleActive = useCallback(
    async (venue: Venue): Promise<VenueDirectoryMutationResult> => {
      const owner = claimMutation();
      if (!owner) return BUSY_MUTATION_RESULT;

      try {
        let error: string | null;
        try {
          ({ error } = await dependencies.updateVenue(venue.id, {
            active: !venue.active,
          }));
        } catch (updateError: unknown) {
          console.error("Failed to update venue:", updateError);
          setListError(t("updateFailed"));
          return { status: "failed", error: null };
        }

        if (error) {
          console.error("Failed to update venue:", error);
          setListError(t("updateFailed"));
          return { status: "failed", error };
        }

        try {
          const refreshResult = await refreshAfterMutation();
          if (refreshResult.status === "stale") {
            return { status: "failed", error: null };
          }
          if (refreshResult.status === "failed") {
            setListError(t("loadFailed"));
            return { status: "failed", error: null };
          }
        } catch (refreshError: unknown) {
          console.error("Failed to refresh venues:", refreshError);
          setListError(t("loadFailed"));
          return { status: "failed", error: null };
        }
        return { status: "applied", error: null };
      } finally {
        releaseMutation(owner);
      }
    },
    [claimMutation, dependencies, refreshAfterMutation, releaseMutation, t],
  );

  const handleSave = useCallback(
    async (
      id: string,
      updates: VenueUpdateInput,
    ): Promise<VenueDirectoryMutationResult> => {
      const owner = claimMutation();
      if (!owner) return BUSY_MUTATION_RESULT;

      try {
        let error: string | null;
        try {
          ({ error } = await dependencies.updateVenue(id, updates));
        } catch (updateError: unknown) {
          console.error("Failed to update venue:", updateError);
          setListError(t("updateFailed"));
          return { status: "failed", error: null };
        }

        if (error) {
          setListError(resolveMutationMessage(error, "updateFailed"));
          return { status: "failed", error };
        }

        setListError("");
        try {
          const refreshResult = await refreshAfterMutation();
          if (refreshResult.status === "stale") {
            return { status: "failed", error: null };
          }
          if (refreshResult.status === "failed") {
            setListError(t("loadFailed"));
            return { status: "failed", error: null };
          }
        } catch (refreshError: unknown) {
          console.error("Failed to refresh venues:", refreshError);
          setListError(t("loadFailed"));
          return { status: "failed", error: null };
        }
        return { status: "applied", error: null };
      } finally {
        releaseMutation(owner);
      }
    },
    [
      claimMutation,
      dependencies,
      refreshAfterMutation,
      releaseMutation,
      resolveMutationMessage,
      t,
    ],
  );

  const listState = deriveAsyncListState({
    hasStarted: isLoading || loadOutcome !== "idle",
    isLoading,
    itemCount: venues.length,
    hasError: loadOutcome === "error",
    isPartial: loadOutcome === "partial",
  });

  return {
    venues,
    isLoading,
    isMutating,
    listError,
    loadOutcome,
    listState,
    loadVenues,
    refreshAfterMutation,
    handleToggleActive,
    handleSave,
  };
}

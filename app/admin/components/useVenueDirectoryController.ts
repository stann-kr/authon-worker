"use client";

import { useCallback, useEffect, useState } from "react";
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
  const requestGuard = useLatestRequestGuard();
  useSectionLoadingTask(isLoading);

  const loadVenues = useCallback(async () => {
    const isLatestRequest = requestGuard.beginRequest();
    setIsLoading(true);
    setListError("");
    try {
      const { data, error } = await dependencies.fetchVenues(true);
      if (!isLatestRequest()) return;
      if (data) setVenues(data);
      if (error) {
        console.error("Failed to load venues:", error);
        setListError(t("loadFailed"));
        setLoadOutcome(data ? "partial" : "error");
      } else {
        setLoadOutcome("success");
      }
    } catch (error: unknown) {
      if (!isLatestRequest()) return;
      console.error("Failed to load venues:", error);
      setListError(t("loadFailed"));
      setLoadOutcome("error");
    } finally {
      if (isLatestRequest()) setIsLoading(false);
    }
  }, [dependencies, requestGuard, t]);

  useEffect(() => {
    loadVenues();
  }, [loadVenues]);

  const refreshAfterMutation = useCallback(async () => {
    await Promise.all([loadVenues(), refreshActiveVenues()]);
  }, [loadVenues, refreshActiveVenues]);

  const handleToggleActive = useCallback(
    async (venue: Venue) => {
      const { error } = await dependencies.updateVenue(venue.id, {
        active: !venue.active,
      });
      if (error) {
        console.error("Failed to update venue:", error);
        setListError(t("updateFailed"));
      } else {
        await refreshAfterMutation();
      }
    },
    [dependencies, refreshAfterMutation, t],
  );

  const handleSave = useCallback(
    async (id: string, updates: VenueUpdateInput) => {
      const { error } = await dependencies.updateVenue(id, updates);
      if (!error) {
        setListError("");
        await refreshAfterMutation();
      } else {
        setListError(resolveMutationMessage(error, "updateFailed"));
      }
      return error;
    },
    [dependencies, refreshAfterMutation, resolveMutationMessage],
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
    listError,
    loadOutcome,
    listState,
    loadVenues,
    refreshAfterMutation,
    handleToggleActive,
    handleSave,
  };
}

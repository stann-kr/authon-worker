"use client";

import { useState, useEffect, useId } from "react";
import { useLatestRequestGuard, useLocalStorage } from "@/lib/hooks";
import { fetchVenues } from "@/lib/api/venues";
import type { Venue } from "@/lib/api/types";
import { getUser } from "@/lib/auth";
import Icon from "./Icon";
import { useTranslations } from "next-intl";
import { useRouteLoadingTask } from "./RouteTransitionProvider";

/**
 * useVenueSelector — super_admin 베뉴 선택 로직 훅.
 * super_admin이 아닌 경우 사용자의 venue_id 를 자동 사용.
 *
 * 사용 예:
 * const { venueId, venues, selectedVenueId, setSelectedVenueId, isSuperAdmin } = useVenueSelector();
 */
export function useVenueSelector() {
  const user = getUser();
  const isSuperAdmin = user?.role === "super_admin";
  const [venues, setVenues] = useState<Venue[]>([]);
  const [isLoadingVenues, setIsLoadingVenues] = useState(true);
  const [selectedVenueId, setSelectedVenueId] = useLocalStorage<string>(
    "admin:selectedVenueId",
    "",
  );
  const requestGuard = useLatestRequestGuard();
  useRouteLoadingTask(isLoadingVenues);

  useEffect(() => {
    const isLatestRequest = requestGuard.beginRequest();
    setIsLoadingVenues(true);

    const loadVenues = async () => {
      try {
        const { data } = await fetchVenues();
        if (!isLatestRequest()) return;
        if (data) {
          setVenues(data);
          if (isSuperAdmin && data.length > 0) {
            setSelectedVenueId((prev) => prev || data[0].id);
          }
        }
      } catch (error: unknown) {
        if (isLatestRequest()) {
          console.error("Failed to load venues:", error);
        }
      } finally {
        if (isLatestRequest()) setIsLoadingVenues(false);
      }
    };

    loadVenues();
  }, [isSuperAdmin, requestGuard, setSelectedVenueId]);

  const venueId = isSuperAdmin ? selectedVenueId : (user?.venue_id ?? "");
  const currentVenue = venues.find((venue) => venue.id === venueId) ?? null;

  return {
    venueId,
    venues,
    selectedVenueId,
    setSelectedVenueId,
    currentVenue,
    isSuperAdmin,
    user,
  };
}

/**
 * VenueSelector — super_admin 전용 베뉴 셀렉터 UI.
 */
interface VenueSelectorProps {
  venues: Venue[];
  selectedVenueId: string;
  onVenueChange: (id: string) => void;
  /** 빈 값 선택 시 표시할 텍스트. 기본값: "-- Select Venue --" */
  placeholder?: string;
  className?: string;
}

export default function VenueSelector({
  venues,
  selectedVenueId,
  onVenueChange,
  placeholder,
  className = "",
}: VenueSelectorProps) {
  const t = useTranslations("Common");
  const selectId = useId();

  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={selectId} className="type-context-title">
        {t("venue")}
      </label>
      <div className="relative">
        <select
          id={selectId}
          value={selectedVenueId}
          onChange={(e) => onVenueChange(e.target.value)}
          className="app-field appearance-none pr-10"
        >
          <option value="">{placeholder ?? t("selectVenue")}</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
      </div>
    </div>
  );
}

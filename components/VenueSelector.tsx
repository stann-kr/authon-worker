"use client";

import { useState, useEffect, useId } from "react";
import { useLocalStorage } from "@/lib/hooks";
import { fetchVenues } from "@/lib/api/venues";
import type { Venue } from "@/lib/api/types";
import { getUser } from "@/lib/auth";

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
  const [selectedVenueId, setSelectedVenueId] = useLocalStorage<string>(
    "admin:selectedVenueId",
    "",
  );

  useEffect(() => {
    if (isSuperAdmin) {
      fetchVenues().then(({ data }) => {
        if (data) {
          setVenues(data);
          if (data.length > 0) {
            setSelectedVenueId((prev) => prev || data[0].id);
          }
        }
      });
    }
  }, [isSuperAdmin, setSelectedVenueId]);

  const venueId = isSuperAdmin ? selectedVenueId : (user?.venue_id ?? "");

  return {
    venueId,
    venues,
    selectedVenueId,
    setSelectedVenueId,
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
  placeholder = "-- Select Venue --",
  className = "",
}: VenueSelectorProps) {
  const selectId = useId();

  return (
    <div
      className={`bg-gray-900 border border-gray-700 p-4 sm:p-5 ${className}`}
    >
      <div className="mb-2">
        <label htmlFor={selectId} className="font-mono text-xs sm:text-sm tracking-wider text-gray-400 uppercase">
          SELECT VENUE
        </label>
      </div>
      <div className="relative">
        <select
          id={selectId}
          value={selectedVenueId}
          onChange={(e) => onVenueChange(e.target.value)}
          className="w-full appearance-none bg-black border border-gray-600 px-4 py-3 pr-10 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-white"
        >
          <option value="">{placeholder}</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <i className="ri-arrow-down-s-line absolute right-3 top-1/2 -translate-y-1/2 text-base text-gray-400 pointer-events-none" aria-hidden="true"></i>
      </div>
    </div>
  );
}

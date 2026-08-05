"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocalStorage } from "@/lib/hooks";
import { fetchVenues } from "@/lib/api/venues";
import type { Venue } from "@/lib/api/types";
import { getUser } from "@/lib/auth";
import Icon from "./Icon";
import { useTranslations } from "next-intl";
import { useSectionLoadingTask } from "./RouteTransitionProvider";

type VenueDataStatus = "idle" | "loading" | "ready";

interface VenueDataContextValue {
  venues: Venue[];
  status: VenueDataStatus;
  selectedVenueId: string;
  setSelectedVenueId: ReturnType<typeof useLocalStorage<string>>[1];
  ensureVenues: () => Promise<void>;
  refreshVenues: () => Promise<void>;
}

const VenueDataContext = createContext<VenueDataContextValue | null>(null);

/**
 * 인증 화면에서 사용하는 활성 베뉴 목록을 route 간에 공유합니다.
 * 실제 조회는 useVenueSelector를 사용하는 화면이 처음 열릴 때만 시작합니다.
 */
export function VenueDataProvider({ children }: { children: ReactNode }) {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [status, setStatus] = useState<VenueDataStatus>("idle");
  const statusRef = useRef<VenueDataStatus>("idle");
  const requestPromiseRef = useRef<Promise<void> | null>(null);
  const requestIdRef = useRef(0);
  const [selectedVenueId, setSelectedVenueId] = useLocalStorage<string>(
    "admin:selectedVenueId",
    "",
  );
  const loadVenues = useCallback(async (force: boolean) => {
    if (!force) {
      if (statusRef.current === "ready") return;
      if (requestPromiseRef.current) return requestPromiseRef.current;
    }

    const requestId = ++requestIdRef.current;
    const isLatestRequest = () => requestId === requestIdRef.current;
    statusRef.current = "loading";
    setStatus("loading");

    const requestPromise = (async () => {
      try {
        const { data, error } = await fetchVenues();
        if (!isLatestRequest()) return;
        if (!data) {
          if (error) console.error("Failed to load venues:", error);
          return;
        }

        const nextVenues = data;
        setVenues(nextVenues);
        if (getUser()?.role === "super_admin") {
          setSelectedVenueId((previousVenueId) => {
            if (nextVenues.some((venue) => venue.id === previousVenueId)) {
              return previousVenueId;
            }
            return nextVenues[0]?.id ?? "";
          });
        }
      } catch (error: unknown) {
        if (isLatestRequest()) {
          console.error("Failed to load venues:", error);
        }
      } finally {
        if (isLatestRequest()) {
          statusRef.current = "ready";
          setStatus("ready");
        }
      }
    })();

    requestPromiseRef.current = requestPromise;
    await requestPromise;
    if (requestPromiseRef.current === requestPromise) {
      requestPromiseRef.current = null;
    }
  }, [setSelectedVenueId]);

  const ensureVenues = useCallback(() => loadVenues(false), [loadVenues]);
  const refreshVenues = useCallback(() => loadVenues(true), [loadVenues]);
  const value = useMemo<VenueDataContextValue>(
    () => ({
      venues,
      status,
      selectedVenueId,
      setSelectedVenueId,
      ensureVenues,
      refreshVenues,
    }),
    [
      ensureVenues,
      refreshVenues,
      selectedVenueId,
      setSelectedVenueId,
      status,
      venues,
    ],
  );

  return (
    <VenueDataContext.Provider value={value}>
      {children}
    </VenueDataContext.Provider>
  );
}

/**
 * useVenueSelector — super_admin 베뉴 선택 로직 훅.
 * super_admin이 아닌 경우 사용자의 venue_id 를 자동 사용.
 *
 * 사용 예:
 * const { venueId, venues, selectedVenueId, setSelectedVenueId, isSuperAdmin } = useVenueSelector();
 */
export function useVenueSelector() {
  const context = useContext(VenueDataContext);
  if (!context) {
    throw new Error("useVenueSelector must be used within VenueDataProvider");
  }

  const user = getUser();
  const isSuperAdmin = user?.role === "super_admin";
  const {
    venues,
    status,
    selectedVenueId,
    setSelectedVenueId,
    ensureVenues,
    refreshVenues,
  } = context;
  useSectionLoadingTask(status !== "ready");

  useEffect(() => {
    void ensureVenues();
  }, [ensureVenues]);

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
    isLoadingVenues: status !== "ready",
    refreshVenues,
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
  disabled?: boolean;
}

export default function VenueSelector({
  venues,
  selectedVenueId,
  onVenueChange,
  placeholder,
  className = "",
  disabled = false,
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
          disabled={disabled}
          onChange={(e) => onVenueChange(e.target.value)}
          className="app-field appearance-none pr-10 disabled:cursor-not-allowed disabled:opacity-60"
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

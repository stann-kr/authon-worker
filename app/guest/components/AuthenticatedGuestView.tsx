"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocalStorage, useGuestPolling } from "@/lib/hooks";
import AdminHeader from "../../admin/components/AdminHeader";
import Footer from "@/components/Footer";
import StatGrid from "@/components/StatGrid";
import PanelHeader from "@/components/PanelHeader";
import Spinner from "@/components/Spinner";
import EmptyState from "@/components/EmptyState";
import Alert from "@/components/Alert";
import VenueSelector, { useVenueSelector } from "@/components/VenueSelector";
import DatePicker from "@/components/DatePicker";
import Button from "@/components/Button";
import GuestListCard from "@/components/GuestListCard";
import GuestSearchInput from "@/components/GuestSearchInput";
import { getBusinessDate, formatDateDisplay } from "@/lib/date";
import {
  fetchGuestsByDate,
  createGuest,
  deleteGuest,
} from "@/lib/api/guests";
import type { Guest } from "@/lib/api/types";
import { type User as AuthUser } from "@/lib/auth";

interface AuthenticatedGuestViewProps {
  user: AuthUser | null;
}

export default function AuthenticatedGuestView({ user }: AuthenticatedGuestViewProps) {
  const [selectedDate, setSelectedDate] = useState<string>(getBusinessDate());
  const [guestName, setGuestName] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isFetching, setIsFetching] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortMode, setSortMode] = useLocalStorage<"default" | "alpha">(
    "guest:sortMode",
    "default",
  );

  // 로딩 중 이전 데이터를 유지하여 화면 깜빡임 방지
  const displayCacheRef = useRef<Guest[]>([]);

  useEffect(() => {
    if (!isFetching) {
      displayCacheRef.current = guests;
    }
  }, [isFetching, guests]);

  const displayDataGuests = isFetching ? displayCacheRef.current : guests;

  // super_admin venue selector
  const {
    venues,
    selectedVenueId,
    setSelectedVenueId,
    isSuperAdmin,
  } = useVenueSelector();
  
  const effectiveVenueId = isSuperAdmin
    ? selectedVenueId
    : (user?.venue_id ?? "");

  const loadGuests = useCallback(async () => {
    if (!effectiveVenueId) return;
    setIsFetching(true);
    setError(null);

    const { data, error: fetchError } = await fetchGuestsByDate(
      selectedDate,
      effectiveVenueId,
    );

    if (fetchError) {
      console.error("Failed to fetch guests:", fetchError);
      setError("Failed to load guest data.");
    } else if (data) {
      setGuests(data);
    }

    setIsFetching(false);
  }, [selectedDate, effectiveVenueId]);

  useEffect(() => {
    loadGuests();
  }, [loadGuests]);

  // 주기적으로 데이터 갱신 (15초)
  useGuestPolling(async () => {
    if (!effectiveVenueId) return;
    const { data } = await fetchGuestsByDate(selectedDate, effectiveVenueId);
    if (data) setGuests(data);
  }, 15000, !!effectiveVenueId);

  const handleSave = async () => {
    if (!guestName.trim()) return;

    if (!effectiveVenueId) {
      console.error("No venue ID available");
      setError("Please select a venue.");
      return;
    }

    setIsLoading(true);
    setError(null);

    const guestLimit = user?.guest_limit ?? 0;
    const activeGuestsCount = filteredGuests.filter((g) => g.status !== "deleted").length;
    
    if (guestLimit > 0 && activeGuestsCount >= guestLimit) {
      setError(`Guest limit reached. (${guestLimit}/day)`);
      setIsLoading(false);
      return;
    }

    const { data, error: createError } = await createGuest({
      venueId: effectiveVenueId,
      name: guestName.trim().toUpperCase(),
      date: selectedDate,
      status: "pending",
      createdByUserId: user?.id,
    });

    if (createError) {
      console.error("Failed to create guest:", createError);
      setError("Failed to register guest.");
      setIsLoading(false);
      return;
    }

    if (data) {
      setGuests((prev) => [...prev, data]);
      setGuestName("");
    }

    setIsLoading(false);
  };

  const handleDelete = async (id: string) => {
    setIsLoading(true);
    setError(null);

    const { data, error: deleteError } = await deleteGuest(id);

    if (deleteError) {
      console.error("Failed to delete guest:", deleteError);
      setError("Failed to delete guest.");
      setIsLoading(false);
      return;
    }

    if (data) {
      setGuests((prev) =>
        prev.map((guest) => (guest.id === id ? data : guest)),
      );
    }

    setIsLoading(false);
  };

  const filteredGuests = displayDataGuests.filter(
    (guest) =>
      guest.date === selectedDate && guest.createdByUserId === user?.id,
  );
  
  const pendingGuests = filteredGuests.filter((g) => g.status === "pending");
  const checkedGuests = filteredGuests.filter((g) => g.status === "checked");
  const activeGuestsCount = filteredGuests.filter((g) => g.status !== "deleted").length;
  
  const guestLimit = user?.guest_limit ?? 0;
  const isAtLimit = guestLimit > 0 && activeGuestsCount >= guestLimit;

  const sortGuestsByName = (list: Guest[]) => {
    return [...list].sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", "ko-KR", {
        sensitivity: "base",
      }),
    );
  };

  const sortGuestsByCreatedAt = (list: Guest[]) => {
    return [...list].sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeA - timeB;
    });
  };

  const sortedGuests =
    sortMode === "alpha"
      ? sortGuestsByName(filteredGuests)
      : sortGuestsByCreatedAt(filteredGuests);
      
  const displayGuests = searchQuery
    ? sortedGuests.filter((g) =>
        g.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : sortedGuests;

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <AdminHeader />
      <div className="flex-1 overflow-x-hidden pt-20 sm:pt-24 flex flex-col">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 w-full lg:flex-1 lg:min-h-0 flex flex-col">
          <div className="mb-4 lg:mb-6 flex-shrink-0 flex flex-col sm:flex-row gap-4">
            {isSuperAdmin && (
              <VenueSelector
                venues={venues}
                selectedVenueId={selectedVenueId}
                onVenueChange={setSelectedVenueId}
                className="flex-1"
              />
            )}
            <DatePicker
              value={selectedDate}
              onChange={setSelectedDate}
              className="flex-1"
            />
          </div>

          {error && <Alert type="error" message={error} className="mb-6" />}

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:gap-6 lg:flex-1 lg:min-h-0">
            <div className="lg:col-span-1 space-y-4 lg:overflow-y-auto">
              <div className="bg-surface border border-border-subtle p-4 sm:p-5">
                <div className="mb-4">
                  <h2 className="font-mono text-base sm:text-lg tracking-wider text-white uppercase mb-1 break-words">
                    GUEST REGISTRATION
                  </h2>
                  <p className="text-text-muted font-mono text-xs tracking-wider mb-1 break-words">
                    SELF SERVICE PORTAL
                  </p>
                  <p className="text-text-muted font-mono text-xs tracking-wider break-words">
                    {formatDateDisplay(selectedDate)}
                  </p>
                </div>
                <div className="text-center mb-4">
                  <div className="text-white font-mono text-3xl sm:text-4xl tracking-wider">
                    {activeGuestsCount}
                  </div>
                  <div className="text-brand-cyan text-xs font-mono tracking-wider uppercase">
                    TOTAL GUESTS
                  </div>
                </div>

                <StatGrid
                  items={[
                    {
                      label: "WAITING",
                      value: pendingGuests.length,
                      color: "yellow",
                    },
                    {
                      label: "CHECKED",
                      value: checkedGuests.length,
                      color: "green",
                    },
                    {
                      label: "REMAINING",
                      value:
                        guestLimit > 0 ? guestLimit - activeGuestsCount : "∞",
                      color: isAtLimit ? "red" : "cyan",
                    },
                  ]}
                  labelClassName="text-[10px] sm:text-xs"
                />
              </div>
            </div>

            <div className="lg:col-span-3 flex flex-col lg:min-h-0">
              <div className="main-content-panel lg:min-h-0 lg:max-h-full">
                <PanelHeader
                  title="GUEST LIST"
                  count={displayGuests.length}
                  sortMode={sortMode}
                  onSortToggle={() =>
                    setSortMode((prev) =>
                      prev === "default" ? "alpha" : "default",
                    )
                  }
                  onRefresh={loadGuests}
                  isLoading={isFetching}
                />

                <GuestSearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                />

                {isFetching && displayDataGuests.length === 0 ? (
                  <Spinner mode="inline" text="LOADING..." />
                ) : displayGuests.length === 0 ? (
                  <EmptyState
                    icon="ri-user-add-line"
                    message={searchQuery ? "NO GUESTS MATCH THIS SEARCH" : "NO GUESTS REGISTERED FOR THIS DATE"}
                  />
                ) : (
                  <div
                    className={`divide-y divide-border-subtle lg:overflow-y-auto transition-opacity duration-200 ${isFetching ? "opacity-50 pointer-events-none" : ""}`}
                  >
                    {displayGuests.map((guest, index) => (
                      <GuestListCard
                        key={guest.id}
                        guest={guest}
                        index={index}
                        variant="user"
                        onDelete={
                          guest.status === "pending"
                            ? () => handleDelete(guest.id)
                            : undefined
                        }
                        isDeleteLoading={isLoading}
                      />
                    ))}
                  </div>
                )}

                {!isAtLimit ? (
                  <div className="p-4 border-t-2 border-border-default">
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 border border-border-default flex items-center justify-center">
                        <span className="text-xs sm:text-sm font-mono text-text-muted">
                          {String(activeGuestsCount + 1).padStart(2, "0")}
                        </span>
                      </div>

                      <label htmlFor="authenticated-guest-name" className="sr-only">
                        게스트 이름
                      </label>
                      <input
                        id="authenticated-guest-name"
                        type="text"
                        value={guestName}
                        onChange={(e) => setGuestName(e.target.value)}
                        placeholder="Enter guest full name"
                        className="flex-1 min-w-0 bg-transparent border-none outline-none text-white font-mono text-sm tracking-wider placeholder-text-dim"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleSave();
                          }
                        }}
                      />

                      <Button
                        onClick={handleSave}
                        disabled={!guestName.trim()}
                        isLoading={isLoading}
                        size="md"
                      >
                        SAVE
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 border-t-2 border-border-default text-center">
                    <p className="text-brand-yellow font-mono text-xs tracking-wider uppercase">
                      GUEST LIMIT REACHED ({guestLimit}/{guestLimit})
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <Footer />
      </div>
    </div>
  );
}

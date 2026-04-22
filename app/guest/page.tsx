"use client";

import { useState, useEffect, Suspense, useRef } from "react";
import { useLocalStorage } from "@/lib/hooks";
import { useSearchParams } from "next/navigation";
import AdminHeader from "../admin/components/AdminHeader";
import AuthGuard from "../../components/AuthGuard";
import Footer from "@/components/Footer";
import StatGrid from "@/components/StatGrid";
import PanelHeader from "@/components/PanelHeader";
import Spinner from "@/components/Spinner";
import EmptyState from "@/components/EmptyState";
import Alert from "@/components/Alert";
import VenueSelector, { useVenueSelector } from "@/components/VenueSelector";
import DatePicker from "@/components/DatePicker";
import { BRAND_NAME } from "@/lib/brand";
import GuestListCard from "@/components/GuestListCard";
import GuestSearchInput from "@/components/GuestSearchInput";
import { getBusinessDate, formatDateDisplay } from "@/lib/date";
import {
  fetchGuestsByDate,
  createGuest,
  deleteGuest,
  validateExternalToken,
  createGuestViaExternalLink,
  deleteGuestViaExternalLink,
  type Guest,
  type ExternalDJLink,
  type Venue,
} from "../../lib/api/guests";

const formatTime = (timeStr: string) => {
  const date = new Date(timeStr);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

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

export default function GuestPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-black flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
        </div>
      }
    >
      <GuestPageRouter />
    </Suspense>
  );
}

/**
 * Router: if ?token= is present, render external DJ flow (no auth needed).
 * Otherwise, render the authenticated DJ flow.
 */
function GuestPageRouter() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  if (token) {
    return <ExternalDJGuestPage token={token} />;
  }

  return (
    <AuthGuard requiredAccess={["guest"]}>
      <AuthenticatedGuestPage />
    </AuthGuard>
  );
}

// ============================================================
// External DJ Guest Page (token-based, no auth)
// ============================================================

function ExternalDJGuestPage({ token }: { token: string }) {
  const [linkInfo, setLinkInfo] = useState<ExternalDJLink | null>(null);
  const [venueInfo, setVenueInfo] = useState<Venue | null>(null);
  const [isValidating, setIsValidating] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useLocalStorage<"default" | "alpha">(
    "guest:sortMode",
    "default",
  );

  useEffect(() => {
    const validate = async () => {
      setIsValidating(true);
      const { data, error } = await validateExternalToken(token);
      if (error) {
        setValidationError(
          typeof error === "string" ? error : error.message || "Invalid link.",
        );
      } else if (data) {
        setLinkInfo(data.link);
        setVenueInfo(data.venue);
        if (data.guests && data.guests.length > 0) {
          setGuests(data.guests);
        }
      }
      setIsValidating(false);
    };
    validate();
  }, [token]);

  const handleSave = async () => {
    if (!guestName.trim() || !linkInfo) return;
    setIsLoading(true);
    setError(null);

    const { data, error: createError } = await createGuestViaExternalLink({
      token,
      guestName: guestName.trim().toUpperCase(),
      date: linkInfo.date,
    });

    if (createError) {
      setError(
        typeof createError === "string"
          ? createError
          : createError.message || "Failed to register guest.",
      );
    } else if (data) {
      setGuests((prev) => [...prev, data]);
      setGuestName("");
      // Update used count locally
      setLinkInfo((prev) =>
        prev ? { ...prev, usedGuests: prev.usedGuests + 1 } : prev,
      );
    }
    setIsLoading(false);
  };

  const handleDelete = async (guestId: string) => {
    setDeletingId(guestId);
    setError(null);

    const { error: deleteError } = await deleteGuestViaExternalLink({
      token,
      guestId,
    });

    if (deleteError) {
      setError(
        typeof deleteError === "string"
          ? deleteError
          : deleteError.message || "Failed to delete guest.",
      );
    } else {
      setGuests((prev) => prev.filter((g) => g.id !== guestId));
      setLinkInfo((prev) =>
        prev ? { ...prev, usedGuests: Math.max(0, prev.usedGuests - 1) } : prev,
      );
    }
    setDeletingId(null);
  };

  if (isValidating) {
    return <Spinner mode="fullscreen" text="VALIDATING LINK..." />;
  }

  if (validationError) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 border-2 border-red-600 mx-auto mb-4 flex items-center justify-center">
            <i className="ri-error-warning-line text-red-400 text-2xl"></i>
          </div>
          <h1 className="font-mono text-xl tracking-wider text-white uppercase mb-2">
            INVALID LINK
          </h1>
          <p className="text-gray-400 font-mono text-xs tracking-wider mb-6">
            {validationError}
          </p>
          <Footer compact />
        </div>
      </div>
    );
  }

  const remaining = linkInfo ? linkInfo.maxGuests - linkInfo.usedGuests : 0;
  const isAtLimit = remaining <= 0;
  const sortedGuests =
    sortMode === "alpha"
      ? sortGuestsByName(guests)
      : sortGuestsByCreatedAt(guests);
  const displayGuests = searchQuery
    ? sortedGuests.filter((g) =>
        g.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : sortedGuests;

  const externalHeader = (
    <div className="fixed top-0 left-0 right-0 z-50 bg-black border-b border-gray-800">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-white"></div>
          <span className="font-mono text-sm tracking-wider text-white uppercase">
            {BRAND_NAME}
          </span>
        </div>
        <span className="font-mono text-xs tracking-wider text-gray-400 uppercase">
          GUEST ACCESS
        </span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {externalHeader}
      <div className="flex-1 overflow-x-hidden pt-16 sm:pt-20 flex flex-col">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 w-full lg:flex-1 lg:min-h-0 flex flex-col">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:gap-6 lg:flex-1 lg:min-h-0">
            <div className="lg:col-span-1 space-y-4 lg:overflow-y-auto">
              <div className="bg-gray-900 border border-gray-700 p-4 sm:p-5">
                <div className="mb-4">
                  <h2 className="font-mono text-base sm:text-lg tracking-wider text-white uppercase mb-1 break-words">
                    {linkInfo?.djName}
                  </h2>
                  <p className="text-gray-400 font-mono text-xs tracking-wider mb-1 break-words">
                    {linkInfo?.event}
                  </p>
                  {venueInfo && (
                    <p className="text-gray-500 font-mono text-xs tracking-wider mb-1 break-words">
                      {venueInfo.name}
                    </p>
                  )}
                  <p className="text-gray-400 font-mono text-xs tracking-wider break-words">
                    {linkInfo ? formatDateDisplay(linkInfo.date) : ""}
                  </p>
                </div>
                <div className="text-center mb-4">
                  <div className="text-white font-mono text-3xl sm:text-4xl tracking-wider">
                    {guests.length}
                  </div>
                  <div className="text-cyan-300 text-xs font-mono tracking-wider uppercase">
                    REGISTERED
                  </div>
                </div>

                <StatGrid
                  items={[
                    { label: "REMAINING", value: remaining, color: "cyan" },
                    {
                      label: "MAX",
                      value: linkInfo?.maxGuests ?? 0,
                      color: "blue",
                    },
                  ]}
                />
              </div>
            </div>

            <div className="lg:col-span-3 flex flex-col lg:min-h-0">
              {error && <Alert type="error" message={error} className="mb-4" />}

              <div className="main-content-panel lg:min-h-0 lg:max-h-full">
                <PanelHeader
                  title="GUEST LIST"
                  count={guests.length}
                  sortMode={sortMode}
                  onSortToggle={() =>
                    setSortMode((prev) =>
                      prev === "default" ? "alpha" : "default",
                    )
                  }
                />

                <GuestSearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                />

                {guests.length === 0 ? (
                  <EmptyState
                    icon="ri-user-add-line"
                    message="ADD YOUR GUESTS ABOVE"
                  />
                ) : (
                  <div className="divide-y divide-gray-700 lg:overflow-y-auto">
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
                        isDeleteLoading={deletingId === guest.id}
                      />
                    ))}
                  </div>
                )}

                {!isAtLimit && (
                  <div className="p-4 border-t-2 border-gray-600">
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 border border-gray-600 flex items-center justify-center">
                        <span className="text-xs sm:text-sm font-mono text-gray-400">
                          {String(guests.length + 1).padStart(2, "0")}
                        </span>
                      </div>

                      <input
                        type="text"
                        value={guestName}
                        onChange={(e) => setGuestName(e.target.value)}
                        placeholder="Enter guest full name"
                        className="flex-1 min-w-0 bg-transparent border-none outline-none text-white font-mono text-sm tracking-wider placeholder-gray-400"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSave();
                        }}
                      />

                      <button
                        onClick={handleSave}
                        disabled={!guestName.trim() || isLoading}
                        className="shrink-0 px-3 sm:px-6 py-2 sm:py-3 bg-white text-black font-mono text-xs tracking-wider uppercase hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isLoading ? (
                          <div className="w-3 h-3 border border-black border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                          "SAVE"
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {isAtLimit && (
                  <div className="p-4 border-t-2 border-gray-600 text-center">
                    <p className="text-yellow-400 font-mono text-xs tracking-wider uppercase">
                      GUEST LIMIT REACHED ({linkInfo?.maxGuests}/
                      {linkInfo?.maxGuests})
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

// ============================================================
// Authenticated Guest Page (existing DJ flow)
// ============================================================

function AuthenticatedGuestPage() {
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
    venueId,
    venues,
    selectedVenueId,
    setSelectedVenueId,
    isSuperAdmin,
    user,
  } = useVenueSelector();
  const effectiveVenueId = isSuperAdmin
    ? selectedVenueId
    : (user?.venue_id ?? "");

  useEffect(() => {
    if (!effectiveVenueId) {
      setIsFetching(false);
      return;
    }
    const loadGuests = async () => {
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
    };

    loadGuests();
  }, [selectedDate, effectiveVenueId]);

  // Polling for real-time updates (every 15 seconds)
  useEffect(() => {
    if (!effectiveVenueId) return;
    const interval = setInterval(async () => {
      try {
        const { data } = await fetchGuestsByDate(
          selectedDate,
          effectiveVenueId,
        );
        if (data) setGuests(data);
      } catch (err) {
        // Silent fail for polling
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [selectedDate, effectiveVenueId]);

  const handleSave = async () => {
    if (!guestName.trim()) return;

    if (!effectiveVenueId) {
      console.error("No venue ID available");
      setError("Please select a venue.");
      return;
    }

    setIsLoading(true);
    setError(null);

    // Guest limit check
    const activeGuests = filteredGuests.filter((g) => g.status !== "deleted");
    const limit = user?.guest_limit ?? 0;
    if (limit > 0 && activeGuests.length >= limit) {
      setError(`Guest limit reached. (${limit}/day)`);
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
  const pendingGuests = filteredGuests.filter(
    (guest) => guest.status === "pending",
  );
  const checkedGuests = filteredGuests.filter(
    (guest) => guest.status === "checked",
  );
  const activeGuests = filteredGuests.filter(
    (guest) => guest.status !== "deleted",
  );
  const guestLimit = user?.guest_limit ?? 0;
  const isAtLimit = guestLimit > 0 && activeGuests.length >= guestLimit;
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
              <div className="bg-gray-900 border border-gray-700 p-4 sm:p-5">
                <div className="mb-4">
                  <h2 className="font-mono text-base sm:text-lg tracking-wider text-white uppercase mb-1 break-words">
                    GUEST REGISTRATION
                  </h2>
                  <p className="text-gray-400 font-mono text-xs tracking-wider mb-1 break-words">
                    SELF SERVICE PORTAL
                  </p>
                  <p className="text-gray-400 font-mono text-xs tracking-wider break-words">
                    {formatDateDisplay(selectedDate)}
                  </p>
                </div>
                <div className="text-center mb-4">
                  <div className="text-white font-mono text-3xl sm:text-4xl tracking-wider">
                    {activeGuests.length}
                  </div>
                  <div className="text-cyan-300 text-xs font-mono tracking-wider uppercase">
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
                        guestLimit > 0 ? guestLimit - activeGuests.length : "∞",
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
                  count={filteredGuests.length}
                  sortMode={sortMode}
                  onSortToggle={() =>
                    setSortMode((prev) =>
                      prev === "default" ? "alpha" : "default",
                    )
                  }
                  isLoading={isFetching}
                />

                <GuestSearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                />

                {isFetching && filteredGuests.length === 0 ? (
                  <Spinner mode="inline" text="LOADING..." />
                ) : filteredGuests.length === 0 ? (
                  <EmptyState
                    icon="ri-user-add-line"
                    message="No guests registered for this date"
                  />
                ) : (
                  <div
                    className={`divide-y divide-gray-700 lg:overflow-y-auto transition-opacity duration-200 ${isFetching ? "opacity-50 pointer-events-none" : ""}`}
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
                  <div className="p-4 border-t-2 border-gray-600">
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 border border-gray-600 flex items-center justify-center">
                        <span className="text-xs sm:text-sm font-mono text-gray-400">
                          {String(activeGuests.length + 1).padStart(2, "0")}
                        </span>
                      </div>

                      <input
                        type="text"
                        value={guestName}
                        onChange={(e) => setGuestName(e.target.value)}
                        placeholder="Enter guest full name"
                        className="flex-1 min-w-0 bg-transparent border-none outline-none text-white font-mono text-sm tracking-wider placeholder-gray-400"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleSave();
                          }
                        }}
                      />

                      <button
                        onClick={handleSave}
                        disabled={!guestName.trim() || isLoading}
                        className="shrink-0 px-3 sm:px-6 py-2 sm:py-3 bg-white text-black font-mono text-xs tracking-wider uppercase hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isLoading ? (
                          <div className="w-3 h-3 border border-black border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                          "SAVE"
                        )}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 border-t-2 border-gray-600 text-center">
                    <p className="text-yellow-400 font-mono text-xs tracking-wider uppercase">
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

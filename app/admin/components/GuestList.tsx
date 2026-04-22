"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useLocalStorage } from "../../../lib/hooks";
import GuestListCard from "../../../components/GuestListCard";
import GuestSearchInput from "../../../components/GuestSearchInput";
import StatGrid from "../../../components/StatGrid";
import PanelHeader from "../../../components/PanelHeader";
import Spinner from "../../../components/Spinner";
import EmptyState from "../../../components/EmptyState";
import VenueSelector, {
  useVenueSelector,
} from "../../../components/VenueSelector";
import { formatDateDisplay } from "../../../lib/date";
import {
  fetchGuestsByDate,
  fetchUsersByVenue,
  fetchExternalLinksByDate,
  updateGuestStatus,
  deleteGuest,
  type Guest,
  type User,
  type ExternalDJLink,
} from "../../../lib/api/guests";

interface GuestListProps {
  selectedDate: string;
}

export default function GuestList({ selectedDate }: GuestListProps) {
  const [selectedDJ, setSelectedDJ] = useState<string>("all");
  const [loadingStates, setLoadingStates] = useState<{
    [key: string]: boolean;
  }>({});
  const [users, setUsers] = useState<User[]>([]);
  const [externalLinks, setExternalLinks] = useState<ExternalDJLink[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useLocalStorage<"default" | "alpha">(
    "guestlist:sortMode",
    "default",
  );

  // 로딩 중 이전 데이터를 유지하여 화면 깜빡임 방지
  const displayCacheRef = useRef<{
    guests: Guest[];
    users: User[];
    externalLinks: ExternalDJLink[];
  }>({
    guests: [],
    users: [],
    externalLinks: [],
  });

  useEffect(() => {
    if (!isFetching) {
      displayCacheRef.current = { guests, users, externalLinks };
    }
  }, [isFetching, guests, users, externalLinks]);

  const displayData = isFetching
    ? displayCacheRef.current
    : { guests, users, externalLinks };

  const { venueId, venues, selectedVenueId, setSelectedVenueId, isSuperAdmin } =
    useVenueSelector();

  const loadData = useCallback(async () => {
    if (!venueId) return;
    setIsFetching(true);
    try {
      const [guestRes, userRes, linkRes] = await Promise.all([
        fetchGuestsByDate(selectedDate, venueId),
        fetchUsersByVenue(venueId),
        fetchExternalLinksByDate(venueId, selectedDate),
      ]);
      if (guestRes.data) setGuests(guestRes.data);
      if (userRes.data) setUsers(userRes.data);
      if (linkRes.data) setExternalLinks(linkRes.data);
    } catch (err) {
      console.error("Failed to load data:", err);
    } finally {
      setIsFetching(false);
    }
  }, [selectedDate, venueId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Polling for real-time updates (every 15 seconds)
  useEffect(() => {
    if (!venueId) return;
    const interval = setInterval(async () => {
      try {
        const { data } = await fetchGuestsByDate(selectedDate, venueId);
        if (data) setGuests(data);
      } catch (err) {
        // Silent fail for polling
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [selectedDate, venueId]);

  const handleStatusChange = async (
    id: string,
    newStatus: Guest["status"],
    action: string,
  ) => {
    setLoadingStates((prev) => ({ ...prev, [`${id}_${action}`]: true }));

    const { data, error } =
      newStatus === "deleted"
        ? await deleteGuest(id)
        : await updateGuestStatus(id, newStatus);

    if (!error && data) {
      setGuests((prev) => prev.map((g) => (g.id === id ? data : g)));
    } else {
      console.error("Failed to update guest status:", error);
    }

    setLoadingStates((prev) => ({ ...prev, [`${id}_${action}`]: false }));
  };

  // Helper: get contributor name for a guest (user or external DJ)
  const getContributorName = (guest: Guest): string | undefined => {
    if (guest.createdByUserId) {
      const u = displayData.users.find((u) => u.id === guest.createdByUserId);
      return u?.name;
    }
    if (guest.externalLinkId) {
      const link = displayData.externalLinks.find(
        (l) => l.id === guest.externalLinkId,
      );
      return link ? `${link.djName} (EXT)` : undefined;
    }
    return undefined;
  };

  const filteredGuests =
    selectedDJ === "all"
      ? displayData.guests
      : selectedDJ.startsWith("ext:")
        ? displayData.guests.filter(
            (guest) => guest.externalLinkId === selectedDJ.replace("ext:", ""),
          )
        : displayData.guests.filter(
            (guest) => guest.createdByUserId === selectedDJ,
          );

  const pendingGuests = filteredGuests.filter(
    (guest) => guest.status === "pending",
  );
  const checkedGuests = filteredGuests.filter(
    (guest) => guest.status === "checked",
  );
  const sortedGuests =
    sortMode === "alpha"
      ? [...filteredGuests].sort((a, b) =>
          (a.name || "").localeCompare(b.name || "", "ko-KR", {
            sensitivity: "base",
          }),
        )
      : [...filteredGuests].sort((a, b) => {
          const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return timeA - timeB;
        });
  const displayGuests = searchQuery
    ? sortedGuests.filter((g) =>
        (g.name || "").toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : sortedGuests;

  const getSelectedDJInfo = () => {
    if (selectedDJ === "all")
      return { name: "ALL USERS", event: "TOTAL OVERVIEW" };
    if (selectedDJ.startsWith("ext:")) {
      const link = displayData.externalLinks.find(
        (l) => l.id === selectedDJ.replace("ext:", ""),
      );
      return link
        ? { name: link.djName, event: "EXTERNAL DJ" }
        : { name: "", event: "" };
    }
    const u = displayData.users.find((u) => u.id === selectedDJ);
    return u
      ? { name: u.name, event: u.role.toUpperCase() }
      : { name: "", event: "" };
  };

  const selectedDJInfo = getSelectedDJInfo();

  // Only show users/links who registered guests on the selected date
  const activeUserIds = new Set(
    displayData.guests.map((g) => g.createdByUserId).filter(Boolean),
  );
  const filteredUsers = displayData.users.filter((u) =>
    activeUserIds.has(u.id),
  );
  const activeExtLinkIds = new Set(
    displayData.guests.map((g) => g.externalLinkId).filter(Boolean),
  );
  const filteredExtLinks = displayData.externalLinks.filter((l) =>
    activeExtLinkIds.has(l.id),
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:gap-6 lg:flex-1 lg:min-h-0">
      <div className="lg:col-span-1 space-y-4 lg:overflow-y-auto">
        {isSuperAdmin && (
          <VenueSelector
            venues={venues}
            selectedVenueId={selectedVenueId}
            onVenueChange={setSelectedVenueId}
          />
        )}
        <div className="bg-gray-900 border border-gray-700 p-4 sm:p-5">
          <div className="mb-4">
            <h3 className="font-mono text-xs sm:text-sm tracking-wider text-gray-400 uppercase mb-3">
              SELECT USER
            </h3>
            <div className="space-y-2">
              <button
                onClick={() => setSelectedDJ("all")}
                className={`w-full p-3 font-mono text-xs tracking-wider uppercase transition-colors ${
                  selectedDJ === "all"
                    ? "bg-white text-black"
                    : "bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
                }`}
              >
                ALL USERS
              </button>
              <div className="relative">
                <select
                  value={selectedDJ === "all" ? "" : selectedDJ}
                  onChange={(e) => setSelectedDJ(e.target.value || "all")}
                  className="w-full appearance-none bg-gray-800 border border-gray-700 px-4 py-4 pr-10 text-white font-mono text-sm tracking-wider uppercase focus:outline-none focus:border-white min-h-[52px]"
                >
                  <option value="">SELECT USER</option>
                  {filteredUsers.map((u) => (
                    <option key={u.id} value={u.id} className="bg-gray-900">
                      {u.name}
                    </option>
                  ))}
                  {filteredExtLinks.map((link) => (
                    <option
                      key={`ext:${link.id}`}
                      value={`ext:${link.id}`}
                      className="bg-gray-900"
                    >
                      {link.djName} (EXT)
                    </option>
                  ))}
                </select>
                <i className="ri-arrow-down-s-line absolute right-3 top-1/2 -translate-y-1/2 text-base text-gray-400 pointer-events-none"></i>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-700 p-4 sm:p-5">
          <div className="mb-4">
            <h2 className="font-mono text-base sm:text-lg tracking-wider text-white uppercase mb-1">
              {selectedDJInfo.name}
            </h2>
            <p className="text-gray-400 font-mono text-xs tracking-wider mb-1">
              {selectedDJInfo.event}
            </p>
            <p className="text-gray-400 font-mono text-xs tracking-wider">
              {formatDateDisplay(selectedDate)}
            </p>
          </div>
          <div className="text-center mb-4">
            <div className="text-white font-mono text-3xl sm:text-4xl tracking-wider">
              {pendingGuests.length + checkedGuests.length}
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
              { label: "CHECKED", value: checkedGuests.length, color: "green" },
            ]}
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
              setSortMode((prev) => (prev === "default" ? "alpha" : "default"))
            }
            onRefresh={loadData}
            isLoading={isFetching}
          />

          <GuestSearchInput
            value={searchQuery}
            onChange={setSearchQuery}
          />

          {isFetching && filteredGuests.length === 0 ? (
            <Spinner mode="inline" text="LOADING..." />
          ) : filteredGuests.length === 0 ? (
            <EmptyState icon="ri-user-line" message="NO GUESTS FOR THIS DATE" />
          ) : (
            <div
              className={`divide-y divide-gray-700 lg:overflow-y-auto transition-opacity duration-200 ${isFetching ? "opacity-50 pointer-events-none" : ""}`}
            >
              {displayGuests.map((guest, index) => {
                return (
                  <GuestListCard
                    key={guest.id}
                    guest={{
                      id: guest.id,
                      name: guest.name,
                      status: guest.status,
                      checkInTime: guest.checkInTime || undefined,
                      createdAt: guest.createdAt || undefined,
                      djId: guest.djId || undefined,
                    }}
                    index={index}
                    variant="admin"
                    djName={getContributorName(guest)}
                    onCheck={() =>
                      handleStatusChange(guest.id, "checked", "check")
                    }
                    onDelete={() =>
                      handleStatusChange(guest.id, "deleted", "remove")
                    }
                    isCheckLoading={loadingStates[`${guest.id}_check`]}
                    isDeleteLoading={loadingStates[`${guest.id}_remove`]}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

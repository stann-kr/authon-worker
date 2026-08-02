"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useLocalStorage, useGuestPolling } from "../../lib/hooks";
import AdminHeader from "../admin/components/AdminHeader";
import AuthGuard from "../../components/AuthGuard";
import Footer from "../../components/Footer";
import GuestListCard from "../../components/GuestListCard";
import GuestSearchInput from "../../components/GuestSearchInput";
import VenueSelector, {
  useVenueSelector,
} from "../../components/VenueSelector";
import DatePicker from "../../components/DatePicker";
import StatGrid from "../../components/StatGrid";
import PanelHeader from "../../components/PanelHeader";
import Spinner from "../../components/Spinner";
import EmptyState from "../../components/EmptyState";
import Alert from "../../components/Alert";
import { getBusinessDate, formatDateDisplay } from "../../lib/date";
import {
  fetchGuestsByDate,
  updateGuestStatus,
  deleteGuest,
} from "../../lib/api/guests";
import { fetchUsersByVenue } from "../../lib/api/users";
import { fetchExternalLinksByDate } from "../../lib/api/external-links";
import type { Guest, User, ExternalDJLink } from "../../lib/api/types";

export default function DoorPage() {
  return (
    <AuthGuard requiredAccess={["door"]}>
      <DoorPageContent />
    </AuthGuard>
  );
}

function DoorPageContent() {
  const [selectedDate, setSelectedDate] = useLocalStorage(
    "door:selectedDate",
    getBusinessDate(),
  );
  const [selectedDJ, setSelectedDJ] = useState<string>("all");
  const [loadingStates, setLoadingStates] = useState<{
    [key: string]: boolean;
  }>({});
  const [users, setUsers] = useState<User[]>([]);
  const [externalLinks, setExternalLinks] = useState<ExternalDJLink[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useLocalStorage<"default" | "alpha">(
    "door:sortMode",
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
    if (!venueId) {
      setIsFetching(false);
      return;
    }
    setIsFetching(true);
    setFeedback(null);
    try {
      const [guestRes, userRes, linkRes] = await Promise.all([
        fetchGuestsByDate(selectedDate, venueId),
        fetchUsersByVenue(venueId),
        fetchExternalLinksByDate(venueId, selectedDate),
      ]);
      if (guestRes.error || userRes.error || linkRes.error) {
        setFeedback("일부 운영 데이터를 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.");
      }
      if (guestRes.data) setGuests(guestRes.data);
      if (userRes.data) setUsers(userRes.data);
      if (linkRes.data) setExternalLinks(linkRes.data);
    } catch (error) {
      console.error("Failed to load data:", error);
      setFeedback("운영 데이터를 불러오지 못했습니다. 네트워크 상태를 확인해주세요.");
    } finally {
      setIsFetching(false);
    }
  }, [selectedDate, venueId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 주기적으로 데이터 갱신 (15초)
  useGuestPolling(async () => {
    if (!venueId) return;
    const { data } = await fetchGuestsByDate(selectedDate, venueId);
    if (data) setGuests(data);
  }, 15000, !!venueId);

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
      setFeedback(null);
    } else {
      console.error("Failed to update guest status:", error);
      setFeedback("게스트 상태를 변경하지 못했습니다. 다시 시도해주세요.");
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

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:gap-6 lg:flex-1 lg:min-h-0">
            <div className="lg:col-span-1 space-y-4 lg:overflow-y-auto">
              {feedback && <Alert type="error" message={feedback} />}
              <div className="bg-surface border border-border-subtle p-4 sm:p-5">
                <div className="mb-4">
                  <label htmlFor="door-user-filter" className="block font-mono text-xs sm:text-sm tracking-wider text-text-muted uppercase mb-3">
                    SELECT USER
                  </label>
                  <div className="relative">
                    <select
                      id="door-user-filter"
                      value={selectedDJ}
                      onChange={(event) => setSelectedDJ(event.target.value)}
                      className="w-full appearance-none bg-surface-hover border border-border-subtle px-4 py-3 pr-10 font-mono text-xs tracking-wider uppercase text-white transition-colors focus:outline-none focus:border-border-focus"
                    >
                      <option value="all">ALL USERS</option>
                      {filteredUsers.map((user) => (
                        <option key={user.id} value={user.id}>{user.name}</option>
                      ))}
                      {filteredExtLinks.map((link) => (
                        <option key={`ext:${link.id}`} value={`ext:${link.id}`}>
                          {link.djName} (EXT)
                        </option>
                      ))}
                    </select>
                    <i className="ri-arrow-down-s-line pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-base text-text-muted" aria-hidden="true"></i>
                  </div>
                </div>
              </div>

              <div className="bg-surface border border-border-subtle p-4 sm:p-5">
                <div className="mb-4">
                  <h2 className="font-mono text-base sm:text-lg tracking-wider text-white uppercase mb-1 break-words">
                    {selectedDJInfo.name}
                  </h2>
                  <p className="text-text-muted font-mono text-xs tracking-wider mb-1 break-words">
                    {selectedDJInfo.event}
                  </p>
                  <p className="text-text-muted font-mono text-xs tracking-wider break-words">
                    {formatDateDisplay(selectedDate)}
                  </p>
                </div>
                <div className="text-center mb-4">
                  <div className="text-white font-mono text-3xl sm:text-4xl tracking-wider">
                    {pendingGuests.length + checkedGuests.length}
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
                  ]}
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
                  onRefresh={loadData}
                  isLoading={isFetching}
                />

                <GuestSearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                />

                {isFetching && displayData.guests.length === 0 ? (
                  <Spinner mode="inline" text="LOADING..." />
                ) : displayGuests.length === 0 ? (
                  <EmptyState
                    icon="ri-user-line"
                    message={searchQuery ? "NO GUESTS MATCH THIS SEARCH" : "NO GUESTS FOR THIS DATE"}
                  />
                ) : (
                  <div
                    className={`divide-y divide-border-subtle lg:overflow-y-auto transition-opacity duration-200 ${isFetching ? "opacity-50 pointer-events-none" : ""}`}
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
                          }}
                          index={index}
                          variant="admin"
                          djName={getContributorName(guest)}
                          onCheck={() =>
                            handleStatusChange(guest.id, "checked", "check")
                          }
                          isCheckLoading={loadingStates[`${guest.id}_check`]}
                        />
                      );
                    })}
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

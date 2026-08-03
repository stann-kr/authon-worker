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
import EmptyState from "../../components/EmptyState";
import Alert from "../../components/Alert";
import Icon from "../../components/Icon";
import Skeleton from "../../components/Skeleton";
import OperationsLayout from "../../components/OperationsLayout";
import { getBusinessDate } from "../../lib/date";
import {
  fetchGuestsByDate,
  updateGuestStatus,
  deleteGuest,
} from "../../lib/api/guests";
import { fetchUsersByVenue } from "../../lib/api/users";
import { fetchExternalLinksByDate } from "../../lib/api/external-links";
import type { Guest, UserDirectoryEntry, ExternalDJLink } from "../../lib/api/types";
import { useLocale, useTranslations } from "next-intl";

export default function DoorPage() {
  return (
    <AuthGuard requiredAccess={["door"]}>
      <DoorPageContent />
    </AuthGuard>
  );
}

function DoorPageContent() {
  const t = useTranslations("Door");
  const locale = useLocale() as "en" | "ko";
  const [selectedDate, setSelectedDate] = useLocalStorage(
    "door:selectedDate",
    getBusinessDate(),
  );
  const [selectedDJ, setSelectedDJ] = useState<string>("all");
  const [loadingStates, setLoadingStates] = useState<{
    [key: string]: boolean;
  }>({});
  const [users, setUsers] = useState<UserDirectoryEntry[]>([]);
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
    users: UserDirectoryEntry[];
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
        setFeedback(t("partialLoadFailed"));
      }
      if (guestRes.data) setGuests(guestRes.data);
      if (userRes.data) setUsers(userRes.data);
      if (linkRes.data) setExternalLinks(linkRes.data);
    } catch (error) {
      console.error("Failed to load data:", error);
      setFeedback(t("loadFailed"));
    } finally {
      setIsFetching(false);
    }
  }, [selectedDate, t, venueId]);

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
      setFeedback(t("updateFailed"));
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
          a.status === b.status
            ? (a.name || "").localeCompare(b.name || "", locale === "ko" ? "ko-KR" : "en-US", {
                sensitivity: "base",
              })
            : a.status === "pending"
              ? -1
              : 1,
        )
      : [...filteredGuests].sort((a, b) => {
          if (a.status !== b.status) {
            return a.status === "pending" ? -1 : 1;
          }
          const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return timeA - timeB;
        });
  const displayGuests = searchQuery
    ? sortedGuests.filter((g) =>
        (g.name || "").toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : sortedGuests;

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
    <div className="flex min-h-[100dvh] flex-col bg-canvas">
      <AdminHeader />
      <div className="flex flex-1 flex-col overflow-x-hidden pt-20 sm:pt-24">
        <div className="page-container">
          <OperationsLayout
            title={t("title")}
            dashboard={
              <>
                <div className="context-bar">
                  <DatePicker
                    value={selectedDate}
                    onChange={setSelectedDate}
                  />
                  <div className="context-filter-grid">
                    {isSuperAdmin && (
                      <VenueSelector
                        venues={venues}
                        selectedVenueId={selectedVenueId}
                        onVenueChange={setSelectedVenueId}
                      />
                    )}
                    <div className="min-w-0">
                      <label htmlFor="door-user-filter" className="type-context-title">
                        {t("guestOwner")}
                      </label>
                      <div className="relative">
                        <select
                          id="door-user-filter"
                          name="guest-owner"
                          value={selectedDJ}
                          onChange={(event) => setSelectedDJ(event.target.value)}
                          autoComplete="off"
                          className="app-field appearance-none pr-10"
                        >
                          <option value="all">{t("allOwners")}</option>
                          {filteredUsers.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.name}
                            </option>
                          ))}
                          {filteredExtLinks.map((link) => (
                            <option key={`ext:${link.id}`} value={`ext:${link.id}`}>
                              {link.djName} ({t("external")})
                            </option>
                          ))}
                        </select>
                        <Icon
                          name="chevron-down"
                          size={18}
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {feedback && <Alert type="error" message={feedback} />}

                <section className="app-panel" aria-labelledby="door-dashboard-title">
                  <PanelHeader
                    title={t("title")}
                    headingLevel={2}
                    headingId="door-dashboard-title"
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
                  <StatGrid
                    items={[
                      {
                        label: t("waiting"),
                        value: pendingGuests.length,
                        color: "waiting",
                      },
                      {
                        label: t("checkedIn"),
                        value: checkedGuests.length,
                        color: "checked",
                      },
                      {
                        label: t("total"),
                        value: pendingGuests.length + checkedGuests.length,
                        color: "default",
                      },
                    ]}
                  />
                </section>
              </>
            }
          >
            <section
              className="main-content-panel"
              aria-labelledby="door-guest-list-title"
              aria-busy={isFetching}
            >
              <PanelHeader
                title={t("guestList")}
                headingLevel={2}
                headingId="door-guest-list-title"
                count={displayGuests.length}
              />

              {isFetching && displayData.guests.length === 0 ? (
                <Skeleton rows={6} />
              ) : displayGuests.length === 0 ? (
                <EmptyState
                  icon="user"
                  message={
                    searchQuery
                      ? t("noSearchResults")
                      : t("noGuestsForDate")
                  }
                />
              ) : (
                <div
                  className={`divide-y divide-border-subtle transition-opacity duration-200 ${
                    isFetching ? "pointer-events-none opacity-50" : ""
                  }`}
                >
                  {displayGuests.map((guest, index) => (
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
                      mode="operations"
                      djName={getContributorName(guest)}
                      onCheck={() =>
                        handleStatusChange(guest.id, "checked", "check")
                      }
                      onUndo={() =>
                        handleStatusChange(guest.id, "pending", "undo")
                      }
                      isCheckLoading={loadingStates[`${guest.id}_check`]}
                      isUndoLoading={loadingStates[`${guest.id}_undo`]}
                    />
                  ))}
                </div>
              )}
            </section>
          </OperationsLayout>
        </div>
        <Footer />
      </div>
    </div>
  );
}

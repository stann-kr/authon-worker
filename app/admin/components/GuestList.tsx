"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useLocalStorage, useGuestPolling } from "../../../lib/hooks";
import GuestListCard from "../../../components/GuestListCard";
import GuestSearchInput from "../../../components/GuestSearchInput";
import StatGrid from "../../../components/StatGrid";
import PanelHeader from "../../../components/PanelHeader";
import EmptyState from "../../../components/EmptyState";
import Alert from "../../../components/Alert";
import Icon from "../../../components/Icon";
import Skeleton from "../../../components/Skeleton";
import DatePicker from "../../../components/DatePicker";
import OperationsLayout from "../../../components/OperationsLayout";
import VenueSelector, {
  useVenueSelector,
} from "../../../components/VenueSelector";
import { formatDateDisplay } from "../../../lib/date";
import {
  fetchGuestsByDate,
  updateGuestStatus,
  deleteGuest,
} from "../../../lib/api/guests";
import { fetchUsersByVenue } from "../../../lib/api/users";
import { fetchExternalLinksByDate } from "../../../lib/api/external-links";
import type { Guest, UserDirectoryEntry, ExternalDJLink } from "../../../lib/api/types";
import { useLocale, useTranslations } from "next-intl";

interface GuestListProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
}

export default function GuestList({
  selectedDate,
  onDateChange,
}: GuestListProps) {
  const t = useTranslations("AdminGuest");
  const doorT = useTranslations("Door");
  const locale = useLocale() as "en" | "ko";
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
    "guestlist:sortMode",
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
        setFeedback(doorT("partialLoadFailed"));
      }
      if (guestRes.data) setGuests(guestRes.data);
      if (userRes.data) setUsers(userRes.data);
      if (linkRes.data) setExternalLinks(linkRes.data);
    } catch (err) {
      console.error("Failed to load data:", err);
      setFeedback(doorT("loadFailed"));
    } finally {
      setIsFetching(false);
    }
  }, [doorT, selectedDate, venueId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 실시간 폴링 (15초 간격) — useGuestPolling 훅으로 통일
  const pollGuests = useCallback(async () => {
    if (!venueId) return;
    const { data } = await fetchGuestsByDate(selectedDate, venueId);
    if (data) setGuests(data);
  }, [selectedDate, venueId]);

  useGuestPolling(pollGuests, 15000, !!venueId);

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
      setFeedback(doorT("updateFailed"));
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
          (a.name || "").localeCompare(b.name || "", locale === "ko" ? "ko-KR" : "en-US", {
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
      return { name: t("allUsers"), event: t("totalOverview") };
    if (selectedDJ.startsWith("ext:")) {
      const link = displayData.externalLinks.find(
        (l) => l.id === selectedDJ.replace("ext:", ""),
      );
      return link
        ? { name: link.djName, event: t("externalDj") }
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
    <OperationsLayout
      title={t("title")}
      dashboard={
        <>
        <div className="context-bar">
          <DatePicker value={selectedDate} onChange={onDateChange} />
        </div>
        {feedback && <Alert type="error" message={feedback} />}
        {isSuperAdmin && (
          <VenueSelector
            venues={venues}
            selectedVenueId={selectedVenueId}
            onVenueChange={setSelectedVenueId}
            className="app-panel p-4 sm:p-5"
          />
        )}
        <div className="app-panel p-4 sm:p-5">
          <div className="mb-4">
            <label htmlFor="admin-guest-user-filter" className="type-context-title mb-3">
              {t("userFilter")}
            </label>
            <div className="space-y-2">
              <button
                onClick={() => setSelectedDJ("all")}
                className={`w-full p-3 text-sm font-medium transition-colors ${
                  selectedDJ === "all"
                    ? "border border-border-default border-l-2 border-l-action-primary bg-surface-raised text-text-heading"
                    : "bg-surface-raised text-text-muted hover:text-text-heading border border-border-default"
                }`}
              >
                {t("allUsers")}
              </button>
              <div className="relative">
                <select
                  id="admin-guest-user-filter"
                  value={selectedDJ === "all" ? "" : selectedDJ}
                  onChange={(e) => setSelectedDJ(e.target.value || "all")}
                  className="w-full appearance-none bg-surface-raised border border-border-default px-4 py-4 pr-10 text-text-heading text-sm font-medium focus:outline-none focus:border-border-focus min-h-[52px]"
                >
                  <option value="">{t("selectUser")}</option>
                  {filteredUsers.map((u) => (
                    <option key={u.id} value={u.id} className="bg-surface">
                      {u.name}
                    </option>
                  ))}
                  {filteredExtLinks.map((link) => (
                    <option
                      key={`ext:${link.id}`}
                      value={`ext:${link.id}`}
                      className="bg-surface"
                    >
                      {link.djName} (EXT)
                    </option>
                  ))}
                </select>
                <Icon name="chevron-down" size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
              </div>
            </div>
          </div>
        </div>

        <div className="app-panel p-4 sm:p-5">
          <div className="mb-4">
            <h2 className="type-panel-title mb-1">
              {selectedDJInfo.name}
            </h2>
            <p className="text-sm text-text-muted mb-1">
              {selectedDJInfo.event}
            </p>
            <p className="text-sm text-text-muted">
              {formatDateDisplay(selectedDate, locale)}
            </p>
          </div>
          <div className="text-center mb-4">
            <div className="text-text-heading font-mono text-3xl sm:text-4xl tracking-wider">
              {pendingGuests.length + checkedGuests.length}
            </div>
            <div className="text-xs font-medium text-text-muted">
              {t("totalGuests")}
            </div>
          </div>

          <StatGrid
            items={[
              {
                label: t("waiting"),
                value: pendingGuests.length,
                color: "waiting",
              },
              { label: t("checked"), value: checkedGuests.length, color: "checked" },
            ]}
          />
        </div>
        </>
      }
    >

      <div className="flex min-w-0 flex-col lg:min-h-0">
        <div className="main-content-panel lg:min-h-0 lg:max-h-full">
          <PanelHeader
            title={t("guestList")}
            count={displayGuests.length}
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

          {isFetching && displayData.guests.length === 0 ? (
            <Skeleton rows={6} />
          ) : displayGuests.length === 0 ? (
            <EmptyState
              icon="user"
              message={searchQuery ? t("noSearchResults") : t("noGuestsForDate")}
            />
          ) : (
            <div
              className={`divide-y divide-border-default lg:overflow-y-auto transition-opacity duration-200 ${isFetching ? "opacity-50 pointer-events-none" : ""}`}
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
                    mode="operations"
                    djName={getContributorName(guest)}
                    showRegisteredAt
                    onCheck={() =>
                      handleStatusChange(guest.id, "checked", "check")
                    }
                    onDelete={() =>
                      handleStatusChange(guest.id, "deleted", "remove")
                    }
                    onUndo={() =>
                      handleStatusChange(guest.id, "pending", "undo")
                    }
                    isCheckLoading={loadingStates[`${guest.id}_check`]}
                    isUndoLoading={loadingStates[`${guest.id}_undo`]}
                    isDeleteLoading={loadingStates[`${guest.id}_remove`]}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </OperationsLayout>
  );
}

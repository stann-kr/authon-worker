"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  useLocalStorage,
  useGuestPolling,
  useLatestRequestGuard,
} from "../../../lib/hooks";
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
import { useSectionLoadingTask } from "../../../components/RouteTransitionProvider";
import VenueSelector, {
  useVenueSelector,
} from "../../../components/VenueSelector";
import { formatDateDisplay } from "../../../lib/date";
import {
  fetchGuestsByDate,
  updateGuestStatus,
  deleteGuest,
} from "../../../lib/api/guests";
import { fetchGuestOperationsSnapshot } from "../../../lib/api/guest-snapshots";
import type {
  ExternalLinkDirectoryEntry,
  Guest,
  UserDirectoryEntry,
} from "../../../lib/api/types";
import { useLocale, useTranslations } from "next-intl";

const EMPTY_DISPLAY_DATA = {
  guests: [] as Guest[],
  users: [] as UserDirectoryEntry[],
  externalLinks: [] as ExternalLinkDirectoryEntry[],
};

interface GuestListProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
  businessDate: string;
}

export default function GuestList({
  selectedDate,
  onDateChange,
  businessDate,
}: GuestListProps) {
  const t = useTranslations("AdminGuest");
  const doorT = useTranslations("Door");
  const locale = useLocale() as "en" | "ko";
  const [selectedDJ, setSelectedDJ] = useState<string>("all");
  const [loadingStates, setLoadingStates] = useState<{
    [key: string]: boolean;
  }>({});
  const [users, setUsers] = useState<UserDirectoryEntry[]>([]);
  const [externalLinks, setExternalLinks] =
    useState<ExternalLinkDirectoryEntry[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [loadedScopeKey, setLoadedScopeKey] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useLocalStorage<"default" | "alpha">(
    "guestlist:sortMode",
    "default",
  );

  // 로딩 중 이전 데이터를 유지하여 화면 깜빡임 방지
  const displayCacheRef = useRef<{
    scopeKey: string;
    guests: Guest[];
    users: UserDirectoryEntry[];
    externalLinks: ExternalLinkDirectoryEntry[];
  }>({
    scopeKey: "",
    guests: [],
    users: [],
    externalLinks: [],
  });

  const { venueId, venues, selectedVenueId, setSelectedVenueId, isSuperAdmin } =
    useVenueSelector();

  const requestScopeKey = `${venueId}:${selectedDate}`;
  const requestGuard = useLatestRequestGuard();
  const pollingGuard = useLatestRequestGuard();

  useEffect(() => {
    if (!isFetching && loadedScopeKey === requestScopeKey) {
      displayCacheRef.current = {
        scopeKey: requestScopeKey,
        guests,
        users,
        externalLinks,
      };
    }
  }, [externalLinks, guests, isFetching, loadedScopeKey, requestScopeKey, users]);

  const hasCurrentScopeData = loadedScopeKey === requestScopeKey;
  const isCurrentScopeFetching = isFetching || !hasCurrentScopeData;
  useSectionLoadingTask(isCurrentScopeFetching);
  const displayData = !hasCurrentScopeData
    ? EMPTY_DISPLAY_DATA
    : isFetching && displayCacheRef.current.scopeKey === requestScopeKey
      ? displayCacheRef.current
      : { guests, users, externalLinks };

  useEffect(() => {
    setSelectedDJ("all");
  }, [requestScopeKey]);

  const loadData = useCallback(async () => {
    pollingGuard.invalidateRequests();
    const isLatestRequest = requestGuard.beginRequest();
    if (!venueId) {
      setGuests([]);
      setUsers([]);
      setExternalLinks([]);
      setLoadedScopeKey(requestScopeKey);
      setIsFetching(false);
      return;
    }
    setIsFetching(true);
    setFeedback(null);
    try {
      const { data, error } = await fetchGuestOperationsSnapshot(
        selectedDate,
        venueId,
      );
      if (!isLatestRequest()) return;
      if (!data) {
        setGuests([]);
        setUsers([]);
        setExternalLinks([]);
        setFeedback(doorT("loadFailed"));
      } else {
        if (error) setFeedback(doorT("partialLoadFailed"));
        setGuests(data.guests);
        setUsers(data.users);
        setExternalLinks(data.externalLinks);
      }
      setLoadedScopeKey(requestScopeKey);
    } catch (err) {
      if (!isLatestRequest()) return;
      console.error("Failed to load data:", err);
      setGuests([]);
      setUsers([]);
      setExternalLinks([]);
      setLoadedScopeKey(requestScopeKey);
      setFeedback(doorT("loadFailed"));
    } finally {
      if (isLatestRequest()) setIsFetching(false);
    }
  }, [doorT, pollingGuard, requestGuard, requestScopeKey, selectedDate, venueId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 실시간 폴링 (15초 간격) — useGuestPolling 훅으로 통일
  const pollGuests = useCallback(async () => {
    if (!venueId || loadedScopeKey !== requestScopeKey) return;
    const isLatestRequest = pollingGuard.beginRequest();
    const { data } = await fetchGuestsByDate(selectedDate, venueId);
    if (isLatestRequest() && loadedScopeKey === requestScopeKey && data) {
      setGuests(data);
    }
  }, [loadedScopeKey, pollingGuard, requestScopeKey, selectedDate, venueId]);

  useGuestPolling(pollGuests, 15000, !!venueId);

  const handleStatusChange = async (
    id: string,
    newStatus: Guest["status"],
    action: string,
  ) => {
    pollingGuard.invalidateRequests();
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

  const getContributor = (guest: Guest): {
    name?: string;
    accountKind: "personal" | "shared";
  } => {
    if (guest.createdByUserId) {
      const u = displayData.users.find((u) => u.id === guest.createdByUserId);
      return { name: u?.name, accountKind: u?.accountKind ?? "personal" };
    }
    if (guest.externalLinkId) {
      const link = displayData.externalLinks.find(
        (l) => l.id === guest.externalLinkId,
      );
      return { name: link ? `${link.djName} (EXT)` : undefined, accountKind: "personal" };
    }
    return { accountKind: "personal" };
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
      variant="stacked"
      title={t("title")}
      dashboard={
        <>
        <div className="context-bar">
          <DatePicker
            value={selectedDate}
            onChange={onDateChange}
            businessDate={businessDate}
          />
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
                type="button"
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
                  name="admin-guest-user-filter"
                  value={selectedDJ === "all" ? "" : selectedDJ}
                  autoComplete="off"
                  onChange={(e) => setSelectedDJ(e.target.value || "all")}
                  className="app-field min-h-[52px] appearance-none py-4 pr-10 font-medium"
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
            <h2 className="type-panel-title mb-1 break-words">
              {selectedDJInfo.name}
            </h2>
            <p className="mb-1 break-words text-sm text-text-muted">
              {selectedDJInfo.event}
            </p>
            <p className="text-sm text-text-muted">
              {formatDateDisplay(selectedDate, locale)}
            </p>
          </div>
          <div className="mb-4 text-center" aria-busy={!hasCurrentScopeData}>
            <div className="text-text-heading font-mono text-3xl sm:text-4xl tracking-wider">
              {hasCurrentScopeData
                ? pendingGuests.length + checkedGuests.length
                : "-"}
            </div>
            <div className="text-xs font-medium text-text-muted">
              {t("totalGuests")}
            </div>
          </div>

          <StatGrid
            isLoading={!hasCurrentScopeData}
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
            isLoading={isCurrentScopeFetching}
          />

          <GuestSearchInput
            value={searchQuery}
            onChange={setSearchQuery}
          />

          {isCurrentScopeFetching && displayData.guests.length === 0 ? (
            <Skeleton rows={6} />
          ) : displayGuests.length === 0 ? (
            <EmptyState
              icon="user"
              message={searchQuery ? t("noSearchResults") : t("noGuestsForDate")}
            />
          ) : (
            <div
              className={`divide-y divide-border-default lg:overflow-y-auto ${isCurrentScopeFetching ? "pointer-events-none" : ""}`}
            >
              {displayGuests.map((guest, index) => {
                const contributor = getContributor(guest);
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
                    djName={contributor.name}
                    accountKind={contributor.accountKind}
                    registeredByName={guest.registeredByName}
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

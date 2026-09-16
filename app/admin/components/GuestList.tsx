"use client";

import RosterView, { type RosterStatus } from "@/components/guests/RosterView";

import { fetchGuestsByDate } from "@/lib/guests/client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  useLocalStorage,
  useGuestPolling,
  useLatestRequestGuard,
  useLatestRef,
  useScopedOperationGuard,
} from "../../../lib/hooks";
import GuestListCard from "../../../components/GuestListCard";


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
import {
  deriveAsyncListState,
  shouldShowEmptyState,
} from "../../../lib/ui/async-list-state";
import {
  updateGuestStatus,
  deleteGuest,
} from "../../../lib/api/guests";
import { fetchGuestOperationsSnapshot } from "@/lib/guest-snapshots/client";
import { fetchDoorAttendanceSummary } from "@/lib/attendance/client";
import type { DoorAttendanceSummary } from "@/lib/attendance/types";
import type { ExternalLinkDirectoryEntry } from "@/lib/external-links/types";
import type { Guest } from "@/lib/guests/types";
import type { UserDirectoryEntry } from "@/lib/users/types";
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
  eventId: string | null;
}

export default function GuestList({
  selectedDate,
  onDateChange,
  businessDate,
  eventId,
}: GuestListProps) {
  const t = useTranslations("AdminGuest");
  const doorT = useTranslations("Door");
  const doorTRef = useLatestRef(doorT);
  const locale = useLocale() as "en" | "ko";
  const [selectedDJ, setSelectedDJ] = useState<string>("all");
  const [loadingStates, setLoadingStates] = useState<{
    [key: string]: boolean;
  }>({});
  const [users, setUsers] = useState<UserDirectoryEntry[]>([]);
  const [externalLinks, setExternalLinks] =
    useState<ExternalLinkDirectoryEntry[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [attendance, setAttendance] = useState<DoorAttendanceSummary | null>(null);
  const [isFetching, setIsFetching] = useState(true);
  const [loadedScopeKey, setLoadedScopeKey] = useState("");
  const [loadOutcome, setLoadOutcome] = useState<
    "idle" | "success" | "partial" | "error"
  >("idle");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [rosterStatus, setRosterStatus] = useState<RosterStatus>("all");
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

  const requestScopeKey = `${venueId}:${selectedDate}:${eventId ?? "general"}`;
  const requestGuard = useLatestRequestGuard();
  const pollingGuard = useLatestRequestGuard();
  const mutationGuard = useScopedOperationGuard();
  const currentScopeKeyRef = useRef(requestScopeKey);
  currentScopeKeyRef.current = requestScopeKey;

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
  const scopedAttendance = attendance?.venueId === venueId &&
    attendance.businessDate === selectedDate && attendance.eventId === eventId ? attendance : null;
  // Named Events can be finalized only after closure; general date rosters can be finalized at any time.
  const scopeClosed = Boolean(scopedAttendance?.isFinalized || (eventId && scopedAttendance?.canFinalize));
  const entryDisabled = !scopedAttendance || scopeClosed || scopedAttendance.unavailableReason === "event_inactive";
  const deleteDisabled = !scopedAttendance || scopeClosed;
  const isCurrentScopeFetching = isFetching || !hasCurrentScopeData;
  const displayData = !hasCurrentScopeData
    ? EMPTY_DISPLAY_DATA
    : isFetching && displayCacheRef.current.scopeKey === requestScopeKey
      ? displayCacheRef.current
      : { guests, users, externalLinks };

  useEffect(() => {
    setSelectedDJ("all");
    setLoadOutcome("idle");
  }, [requestScopeKey]);

  const loadData = useCallback(async () => {
    pollingGuard.invalidateRequests();
    const isLatestRequest = requestGuard.beginRequest();
    if (!venueId) {
      setAttendance(null);
      setGuests([]);
      setUsers([]);
      setExternalLinks([]);
      setLoadedScopeKey(requestScopeKey);
      setLoadOutcome("success");
      setIsFetching(false);
      return;
    }
    setIsFetching(true);
    setFeedback(null);
    try {
      const [{ data, error }, summary] = await Promise.all([
        fetchGuestOperationsSnapshot(selectedDate, venueId, eventId),
        fetchDoorAttendanceSummary({ scope: { venueId, businessDate: selectedDate, eventId } }),
      ]);
      if (!isLatestRequest()) return;
      setAttendance(summary.data);
      if (!data) {
        setGuests([]);
        setUsers([]);
        setExternalLinks([]);
        setFeedback(doorTRef.current("loadFailed"));
        setLoadOutcome("error");
      } else {
        if (error || !summary.data) {
          setFeedback(doorTRef.current("partialLoadFailed"));
          setLoadOutcome("partial");
        } else {
          setLoadOutcome("success");
        }
        setGuests(data.guests);
        setUsers(data.users);
        setExternalLinks(data.externalLinks);
      }
      setLoadedScopeKey(requestScopeKey);
    } catch (err) {
      if (!isLatestRequest()) return;
      console.error("Failed to load data:", err);
      setAttendance(null);
      setGuests([]);
      setUsers([]);
      setExternalLinks([]);
      setLoadedScopeKey(requestScopeKey);
      setFeedback(doorTRef.current("loadFailed"));
      setLoadOutcome("error");
    } finally {
      if (isLatestRequest()) setIsFetching(false);
    }
  }, [doorTRef, eventId, pollingGuard, requestGuard, requestScopeKey, selectedDate, venueId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 실시간 폴링 (15초 간격) — useGuestPolling 훅으로 통일
  const pollGuests = useCallback(async () => {
    if (!venueId || loadedScopeKey !== requestScopeKey) return;
    const isLatestRequest = pollingGuard.beginRequest();
    const [{ data }, summary] = await Promise.all([
      fetchGuestsByDate(selectedDate, venueId, eventId),
      fetchDoorAttendanceSummary({ scope: { venueId, businessDate: selectedDate, eventId } }),
    ]);
    if (isLatestRequest() && loadedScopeKey === requestScopeKey) {
      if (data) setGuests(data);
      if (summary.data) setAttendance(summary.data);
    }
  }, [eventId, loadedScopeKey, pollingGuard, requestScopeKey, selectedDate, venueId]);

  const pollingCoordinator = useGuestPolling(pollGuests, 15000, !!venueId && !isFetching);

  useEffect(() => {
    mutationGuard.invalidateOperations();
    pollingGuard.invalidateRequests();
    pollingCoordinator.clearSuspensions();
    setLoadingStates({});
    setFeedback(null);
  }, [mutationGuard, pollingCoordinator, pollingGuard, requestScopeKey]);

  const handleStatusChange = async (
    id: string,
    newStatus: Guest["status"],
    action: string,
  ) => {
    if (newStatus === "deleted" ? deleteDisabled : entryDisabled) return;
    const operationScopeKey = requestScopeKey;
    const busyKey = `${id}_${action}`;
    const operation = mutationGuard.beginOperation(
      operationScopeKey,
      busyKey,
    );
    const releasePolling = pollingCoordinator.suspend();
    pollingGuard.invalidateRequests();
    setLoadingStates((prev) => ({ ...prev, [busyKey]: true }));

    try {
      const { data, error } =
        newStatus === "deleted"
          ? await deleteGuest(id)
          : await updateGuestStatus(id, newStatus, crypto.randomUUID());

      if (!operation.isCurrent(currentScopeKeyRef.current)) return;
      if (!error && data) {
        setGuests((prev) => prev.map((guest) => (guest.id === id ? data : guest)));
        setFeedback(null);
        await loadData();
      } else {
        console.error("Failed to update guest status:", error);
        setFeedback(
          error === "ATTENDANCE_SCOPE_CLOSED"
            ? doorT("attendanceScopeClosed")
            : doorT("updateFailed"),
        );
      }
    } catch (error) {
      if (!operation.isCurrent(currentScopeKeyRef.current)) return;
      console.error("Failed to update guest status:", error);
      setFeedback(doorT("updateFailed"));
    } finally {
      releasePolling();
      if (operation.finish(currentScopeKeyRef.current)) {
        setLoadingStates((prev) => ({ ...prev, [busyKey]: false }));
      }
    }
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
  const displayGuests = sortedGuests.filter((guest) =>
    (rosterStatus === "all" || guest.status === rosterStatus) &&
    [guest.name, guest.registeredByName, getContributor(guest).name].some((value) =>
      value?.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase())));
  const listState = deriveAsyncListState({
    hasStarted: isFetching || loadOutcome !== "idle",
    isLoading: isCurrentScopeFetching,
    itemCount: displayGuests.length,
    hasError: loadOutcome === "error",
    isPartial: loadOutcome === "partial",
  });

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
      headingLevel={null}
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
        {scopedAttendance && entryDisabled && <p role="status" className="text-sm text-text-muted">
          {doorT(scopedAttendance.isFinalized ? "attendance.scopeClosed" : "attendance.eventInactive")}
        </p>}
        {isSuperAdmin && (
          <VenueSelector
            venues={venues}
            selectedVenueId={selectedVenueId}
            onVenueChange={setSelectedVenueId}
            className="app-panel p-4 sm:p-5"
          />
        )}
        <div className="min-w-0">
          <label htmlFor="admin-guest-user-filter" className="app-label">{t("userFilter")}</label>
              <div className="relative">
                <select
                  id="admin-guest-user-filter"
                  name="admin-guest-user-filter"
                  value={selectedDJ === "all" ? "" : selectedDJ}
                  autoComplete="off"
                  onChange={(e) => setSelectedDJ(e.target.value || "all")}
                  className="app-field min-h-11 appearance-none pr-10 font-medium"
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
        </>
      }
    >

      <div className="flex min-w-0 flex-col lg:min-h-0">
        <div className="min-w-0">
          <RosterView header={<PanelHeader
            title={t("guestList")}
            count={displayGuests.length}
            sortMode={sortMode}
            onSortToggle={() =>
              setSortMode((prev) => (prev === "default" ? "alpha" : "default"))
            }
            onRefresh={loadData}
            isLoading={isCurrentScopeFetching}
          />} query={searchQuery} onQueryChange={setSearchQuery}
            status={rosterStatus} onStatusChange={setRosterStatus}
            loading={!hasCurrentScopeData} counts={{ all: filteredGuests.length, pending: pendingGuests.length, checked: checkedGuests.length }}>




          {listState === "loading" ? (
            <Skeleton rows={6} />
          ) : shouldShowEmptyState(listState) ? (
            <EmptyState
              icon="user"
              message={searchQuery || rosterStatus !== "all" ? t("noSearchResults") : t("noGuestsForDate")}
            />
          ) : (
            <div
              className={`product-roster-rows ${isCurrentScopeFetching ? "pointer-events-none" : ""}`}
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
                    isEntryDisabled={entryDisabled}
                    isDeleteDisabled={deleteDisabled}
                    isDeleteLoading={loadingStates[`${guest.id}_remove`]}
                  />
                );
              })}
            </div>
          )}
          </RosterView>
        </div>
      </div>
    </OperationsLayout>
  );
}

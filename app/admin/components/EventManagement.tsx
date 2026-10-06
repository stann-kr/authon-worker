"use client";

import { fetchEvents } from "@/lib/events/client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import Sheet, { requestSheetClose } from "@/components/overlays/Sheet";
import { confirmWorkspaceNavigation } from "@/components/overlays/navigation-guard";
import Button from "@/components/Button";
import Alert from "@/components/Alert";
import ConfirmDialog from "@/components/ConfirmDialog";
import DatePicker from "@/components/DatePicker";
import EmptyState from "@/components/EmptyState";
import PanelHeader from "@/components/PanelHeader";
import Skeleton from "@/components/Skeleton";
import VenueSelector, { useVenueSelector } from "@/components/VenueSelector";
import { useToast } from "@/components/feedback/ToastProvider";
import { RecordStatus, type RecordStatusTone } from "@/components/records/RecordList";
import { formatDateDisplay, formatVenueDateTime } from "@/lib/date";
import {
  createEvent,
  transitionEventState,
} from "@/lib/api/events";
import type { Event, EventState } from "@/lib/events/types";
import { useLatestRequestGuard } from "@/lib/hooks";
import { deriveAsyncListState, shouldShowEmptyState } from "@/lib/ui/async-list-state";
import EventCloseout from "./EventCloseout";

interface EventManagementProps {
  scopeSelector?: (controls: ReactNode, disabled?: boolean) => ReactNode;
  selectedDate: string;
  onDateChange: (date: string) => void;
  businessDate: string;
  selectedEventId: string | null;
  onSelectedEventChange: (eventId: string | null) => void;
  onEventsChanged: () => void;
}

const EMPTY_EVENTS: Event[] = [];
const EVENT_STATE_TONES: Record<EventState, RecordStatusTone> = {
  draft: "waiting",
  open: "ok",
  closed: "neutral",
  archived: "inactive",
};

export default function EventManagement({
  scopeSelector,
  selectedDate,
  onDateChange,
  businessDate,
  selectedEventId,
  onSelectedEventChange,
  onEventsChanged,
}: EventManagementProps) {
  const t = useTranslations("EventAdmin");
  const commonT = useTranslations("Common");
  const locale = useLocale() as "en" | "ko";
  const showToast = useToast();
  const {
    venueId,
    venues,
    selectedVenueId,
    setSelectedVenueId,
    isSuperAdmin,
    currentVenue,
  } = useVenueSelector();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(selectedEventId);
  const [events, setEvents] = useState<Event[]>([]);
  const [loadedScope, setLoadedScope] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingTransition, setPendingTransition] = useState<{
    scope: string;
    eventId: string;
    fromState: EventState;
    nextState: "closed" | "archived";
  } | null>(null);
  const eventCardRefs = useRef(new Map<string, HTMLElement>());
  const isMutatingRef = useRef(false);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [targetGuests, setTargetGuests] = useState("");
  const [templateSourceEventId, setTemplateSourceEventId] = useState<string | null>(null);
  // Success is announced through the global toast; failures stay where the action happened.
  const [actionError, setActionError] = useState<{ target: "create" | string; message: string } | null>(null);
  const requestGuard = useLatestRequestGuard();
  const scope = `${venueId ?? ""}:${selectedDate}`;

  const loadEvents = useCallback(async () => {
    const isLatest = requestGuard.beginRequest();
    if (!venueId) {
      setEvents([]);
      setLoadedScope(scope);
      setLoadError(false);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(false);
    const response = await fetchEvents({ venueId, businessDate: selectedDate });
    if (!isLatest()) return;
    if (response.error || !response.data) {
      setEvents([]);
      setLoadError(true);
    } else {
      setEvents(response.data);
    }
    setLoadedScope(scope);
    setIsLoading(false);
  }, [requestGuard, scope, selectedDate, venueId]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    setActionError(null);
    setTemplateSourceEventId(null);
    setPendingTransition(null);
  }, [scope]);

  useEffect(() => { setDetailId(selectedEventId); }, [selectedEventId, scope]);

  const scopedEvents = loadedScope === scope ? events : EMPTY_EVENTS;
  // Compatibility events are hidden from this list, so the empty state follows the rendered rows.
  const explicitEvents = useMemo(
    () => scopedEvents.filter((event) => event.compatibilityKey === null),
    [scopedEvents],
  );
  const listState = deriveAsyncListState({
    hasStarted: isLoading || loadedScope !== "",
    isLoading: isLoading || loadedScope !== scope,
    itemCount: explicitEvents.length,
    hasError: loadError,
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!venueId || busyId || isMutatingRef.current) return;
    isMutatingRef.current = true;
    const draft = {
      venueId,
      businessDate: selectedDate,
      name,
      capacity: capacity === "" ? null : Number(capacity),
      targetGuests: targetGuests === "" ? null : Number(targetGuests),
      templateSourceEventId,
    };
    setBusyId("create");
    setActionError(null);
    try {
      const response = await createEvent(draft);
      if (response.error || !response.data) {
        setActionError({ target: "create", message: t("createFailed") });
      } else {
        setName("");
        setCapacity("");
        setTargetGuests("");
        setTemplateSourceEventId(null);
        setCreateOpen(false);
        onSelectedEventChange(response.data.event.id);
        showToast({
          message: response.data.event.templateSourceEventId
            ? t("createdFromTemplate")
            : t("created"),
        });
        await loadEvents();
        onEventsChanged();
      }
    } catch {
      setActionError({ target: "create", message: t("createFailed") });
    } finally {
      isMutatingRef.current = false;
      setBusyId(null);
    }
  };

  const transition = async (event: Event, nextState: EventState) => {
    if (busyId || isMutatingRef.current) return;
    const confirmed = nextState === "closed" || nextState === "archived";
    if (confirmed) {
      if (
        pendingTransition?.scope !== scope ||
        pendingTransition.eventId !== event.id ||
        pendingTransition.fromState !== event.state ||
        pendingTransition.nextState !== nextState
      ) return;
    } else {
      eventCardRefs.current.get(event.id)?.focus({ preventScroll: true });
    }
    isMutatingRef.current = true;
    setBusyId(event.id);
    setActionError(null);
    let succeeded = false;
    try {
      const response = await transitionEventState(event.id, nextState);
      if (response.error || !response.data) {
        setActionError({ target: event.id, message: t("transitionFailed") });
      } else {
        succeeded = true;
        showToast({ message: t("stateChanged") });
        await loadEvents();
        onEventsChanged();
      }
    } catch {
      setActionError({ target: event.id, message: t("transitionFailed") });
    } finally {
      if (confirmed && succeeded) {
        // The confirming control disappears with the old state, so keep focus inside the record.
        eventCardRefs.current.get(event.id)?.focus({ preventScroll: true });
        setPendingTransition(null);
      }
      window.requestAnimationFrame(() => {
        if (document.activeElement === document.body) {
          eventCardRefs.current.get(event.id)?.focus({ preventScroll: true });
        }
      });
      isMutatingRef.current = false;
      setBusyId(null);
    }
  };

  const renderDetails = (event: Event) => {
    const isSelected = selectedEventId === event.id;
    const isBusy = Boolean(busyId);
    const eventTransition = pendingTransition?.scope === scope &&
        pendingTransition.eventId === event.id &&
        pendingTransition.fromState === event.state
      ? pendingTransition
      : null;
    const eventError = actionError?.target === event.id ? actionError.message : null;
    const nextStates: EventState[] =
      event.state === "draft"
        ? ["open", "archived"]
        : event.state === "open"
          ? ["closed"]
          : event.state === "closed"
            ? ["archived"]
            : [];
    return <div tabIndex={-1} ref={(element) => { if (element) eventCardRefs.current.set(event.id, element); else eventCardRefs.current.delete(event.id); }} className="space-y-4">
      {eventError && !eventTransition && <Alert type="error" message={eventError} />}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <RecordStatus tone={EVENT_STATE_TONES[event.state]}>{t(`state.${event.state}`)}</RecordStatus>
          <time className="text-sm text-text-muted" dateTime={event.businessDate}>{formatDateDisplay(event.businessDate, locale)}</time>
        </div>
        <span className="shrink-0 font-mono text-xs text-text-muted">
          {t("capacity")} {event.capacity ?? "—"}
        </span>
      </div>
      {(event.doorOpensAt || event.guestCutoffAt) && (
        <p className="mt-3 text-xs text-text-muted">
          {event.doorOpensAt
            ? formatVenueDateTime(event.doorOpensAt, {
                locale,
                timeZone: currentVenue?.timezone,
              }) ?? "—"
            : "—"}
          {" → "}
          {event.guestCutoffAt
            ? formatVenueDateTime(event.guestCutoffAt, {
                locale,
                timeZone: currentVenue?.timezone,
              }) ?? "—"
            : "—"}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          size="sm"
          variant={isSelected ? "secondary" : "outline"}
          aria-pressed={isSelected}
          onClick={() => onSelectedEventChange(isSelected ? null : event.id)}
          disabled={isBusy}
        >
          {isSelected ? t("selected") : t("useForOperations")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (createOpen && !confirmWorkspaceNavigation()) return;
            setDetailId(null);
            setActionError(null);
            setCreateOpen(true);
            setName(`${event.name} ${t("copySuffix")}`.trim());
            setCapacity(event.capacity?.toString() ?? "");
            setTargetGuests(event.targetGuests?.toString() ?? "");
            setTemplateSourceEventId(event.id);
          }}
          disabled={isBusy}
        >
          {t("useTemplate")}
        </Button>
        {nextStates.map((state) => (
          <Button
            key={state}
            size="sm"
            variant={state === "open" ? "secondary" : "danger"}
            onClick={() => {
              if (state === "closed" || state === "archived") {
                setActionError(null);
                setPendingTransition({
                  scope,
                  eventId: event.id,
                  fromState: event.state,
                  nextState: state,
                });
              } else {
                void transition(event, state);
              }
            }}
            aria-expanded={state === "closed" || state === "archived"
              ? eventTransition?.nextState === state
              : undefined}
            isLoading={state === "open" && busyId === event.id}
            disabled={isBusy}
          >
            {t(`transition.${state}`)}
          </Button>
        ))}
      </div>
      <ConfirmDialog
        open={Boolean(eventTransition)}
        title={eventTransition ? t(`transition.${eventTransition.nextState}`) : ""}
        description={eventTransition ? t(`transitionConfirm.${eventTransition.nextState}`) : undefined}
        confirmLabel={eventTransition ? t(`transition.${eventTransition.nextState}`) : ""}
        cancelLabel={t("cancel")}
        onConfirm={() => { if (eventTransition) void transition(event, eventTransition.nextState); }}
        onCancel={() => { setActionError(null); setPendingTransition(null); }}
        isLoading={busyId === event.id}
      >
        {eventError && <Alert type="error" message={eventError} />}
      </ConfirmDialog>
      <EventCloseout eventId={event.id} eventState={event.state} timeZone={currentVenue?.timezone} />
    </div>;
  };

  const scopeControls = <>
    <DatePicker compact value={selectedDate} onChange={onDateChange} businessDate={businessDate} disabled={Boolean(busyId)} />
    {isSuperAdmin && venues.length > 0 && <VenueSelector venues={venues} selectedVenueId={selectedVenueId}
      onVenueChange={setSelectedVenueId} disabled={Boolean(busyId)} className="scope-venue" />}
  </>;

  return (
    <div className="space-y-4">
      {scopeSelector ? scopeSelector(scopeControls, Boolean(busyId)) : <div className="operations-scope">{scopeControls}</div>}

      <section className="record-collection" aria-labelledby="event-list-title">
        <PanelHeader
          title={t("listTitle")}
          headingId="event-list-title"
          actions={<Button aria-expanded={createOpen} aria-controls={createOpen ? "event-create-panel" : undefined} onClick={() => { setActionError(null); if (createOpen) requestSheetClose("event-create-panel"); else setCreateOpen(true); }} disabled={!venueId || Boolean(busyId)}>{t("createTitle")}</Button>}
          count={explicitEvents.length}
          onRefresh={loadEvents}
          isLoading={isLoading}
        />
      <Sheet id="event-create-panel" presentation="inline" size="form" revealOnOpen open={createOpen} title={t("createTitle")} onClose={() => {
        setCreateOpen(false); setName(""); setCapacity(""); setTargetGuests(""); setTemplateSourceEventId(null);
      }} dirty={Boolean(name || capacity || targetGuests)} busy={Boolean(busyId)}>
        <p className="text-sm text-text-muted">{currentVenue?.brandName || currentVenue?.name} · {commonT("operationalDate")} <time dateTime={selectedDate}>{formatDateDisplay(selectedDate, locale)}</time></p>
        {actionError?.target === "create" && <Alert type="error" message={actionError.message} />}
        <form onSubmit={submit}>
          <fieldset disabled={Boolean(busyId) || !venueId} className="grid gap-4">
            <div>
              <label htmlFor="event-name" className="app-label">{t("name")}</label>
              <input
                id="event-name"
                name="event-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                required
                autoComplete="off"
                className="app-field"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="event-capacity" className="app-label">{t("capacity")}</label>
                <input
                  id="event-capacity"
                  name="event-capacity"
                  type="number"
                  min="1"
                  max="100000"
                  value={capacity}
                  onChange={(event) => setCapacity(event.target.value)}
                  className="app-field"
                />
              </div>
              <div>
                <label htmlFor="event-target" className="app-label">{t("target")}</label>
                <input
                  id="event-target"
                  name="event-target"
                  type="number"
                  min="0"
                  max="100000"
                  value={targetGuests}
                  onChange={(event) => setTargetGuests(event.target.value)}
                  className="app-field"
                />
              </div>
            </div>
            {templateSourceEventId && (
              <p className="app-helper" role="status">
                {t("templateSelected")}
              </p>
            )}
            <Button
              type="submit"
              size="lg"
              fullWidth
              isLoading={busyId === "create"}
              disabled={!venueId || !name.trim() || Boolean(busyId)}
            >
              {busyId === "create" ? t("creating") : t("create")}
            </Button>
          </fieldset>
        </form>
      </Sheet>
        <div className="record-collection-body">
          {loadError && <Alert type="error" message={t("loadFailed")} />}
          {!venueId ? (
            <p className="py-4 text-sm text-text-muted">
              {t("selectVenue")}
            </p>
          ) : listState === "loading" ? (
            <Skeleton rows={4} />
          ) : shouldShowEmptyState(listState) ? (
            <EmptyState icon="calendar" message={t("empty")} />
          ) : (
            <div className="record-list">
              {explicitEvents.map((event) => <article key={event.id} className="record-row">
                <div className="record-summary">
                  <button type="button" className="record-open" onClick={() => { setActionError(null); setDetailId(detailId === event.id ? null : event.id); setPendingTransition(null); }} disabled={Boolean(busyId)} aria-expanded={detailId === event.id} aria-controls={detailId === event.id ? `event-detail-${event.id}` : undefined}>
                    <span className="record-identity"><strong id={`event-label-${event.id}`}>{event.name}</strong><small>{formatDateDisplay(event.businessDate, locale)}{selectedEventId === event.id ? ` · ${t("selected")}` : ""}</small></span>
                    <span className="record-value">{t("capacity")} {event.capacity ?? "—"}</span>
                    <RecordStatus tone={EVENT_STATE_TONES[event.state]}>{t(`state.${event.state}`)}</RecordStatus>
                  </button>
                </div>
                {detailId === event.id && <Sheet labelledBy={`event-label-${event.id}`} id={`event-detail-${event.id}`} title={event.name} presentation="detail" size="record" onClose={() => { setDetailId(null); setPendingTransition(null); setActionError(null); }} busy={Boolean(busyId)}>
                  {renderDetails(event)}
                </Sheet>}
              </article>)}
            </div>
          )}
        </div>
      </section>



    </div>
  );
}

"use client";

import { fetchEvents } from "@/lib/events/client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import Sheet, { requestSheetClose } from "@/components/overlays/Sheet";
import Button from "@/components/Button";
import Alert from "@/components/Alert";
import DatePicker from "@/components/DatePicker";
import EmptyState from "@/components/EmptyState";
import PanelHeader from "@/components/PanelHeader";
import Skeleton from "@/components/Skeleton";
import VenueSelector, { useVenueSelector } from "@/components/VenueSelector";
import { formatVenueDateTime } from "@/lib/date";
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
  const locale = useLocale() as "en" | "ko";
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
  const transitionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cancelTransitionRef = useRef<HTMLButtonElement>(null);
  const eventCardRefs = useRef(new Map<string, HTMLElement>());
  const isMutatingRef = useRef(false);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [targetGuests, setTargetGuests] = useState("");
  const [templateSourceEventId, setTemplateSourceEventId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
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
    setFeedback(null);
    setTemplateSourceEventId(null);
    setPendingTransition(null);
  }, [scope]);

  useEffect(() => {
    if (pendingTransition) cancelTransitionRef.current?.focus();
  }, [pendingTransition]);

  useEffect(() => { setDetailId(selectedEventId); }, [selectedEventId, scope]);

  const scopedEvents = loadedScope === scope ? events : EMPTY_EVENTS;
  const listState = deriveAsyncListState({
    hasStarted: isLoading || loadedScope !== "",
    isLoading: isLoading || loadedScope !== scope,
    itemCount: scopedEvents.length,
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
    setFeedback(null);
    try {
      const response = await createEvent(draft);
      if (response.error || !response.data) {
        setFeedback({ type: "error", message: t("createFailed") });
      } else {
        setName("");
        setCapacity("");
        setTargetGuests("");
        setTemplateSourceEventId(null);
        setCreateOpen(false);
        onSelectedEventChange(response.data.event.id);
        setFeedback({
          type: "success",
          message: response.data.event.templateSourceEventId
            ? t("createdFromTemplate")
            : t("created"),
        });
        await loadEvents();
        onEventsChanged();
      }
    } catch {
      setFeedback({ type: "error", message: t("createFailed") });
    } finally {
      isMutatingRef.current = false;
      setBusyId(null);
    }
  };

  const transition = async (event: Event, nextState: EventState) => {
    if (busyId || isMutatingRef.current) return;
    if (nextState === "closed" || nextState === "archived") {
      if (
        pendingTransition?.scope !== scope ||
        pendingTransition.eventId !== event.id ||
        pendingTransition.fromState !== event.state ||
        pendingTransition.nextState !== nextState
      ) return;
    }
    isMutatingRef.current = true;
    setPendingTransition(null);
    eventCardRefs.current.get(event.id)?.focus({ preventScroll: true });
    setBusyId(event.id);
    setFeedback(null);
    try {
      const response = await transitionEventState(event.id, nextState);
      if (response.error || !response.data) {
        setFeedback({ type: "error", message: t("transitionFailed") });
      } else {
        setFeedback({ type: "success", message: t("stateChanged") });
        await loadEvents();
        onEventsChanged();
      }
    } catch {
      setFeedback({ type: "error", message: t("transitionFailed") });
    } finally {
      window.requestAnimationFrame(() => {
        if (document.activeElement === document.body) {
          eventCardRefs.current.get(event.id)?.focus({ preventScroll: true });
        }
      });
      isMutatingRef.current = false;
      setBusyId(null);
    }
  };

  const explicitEvents = useMemo(
    () => scopedEvents.filter((event) => event.compatibilityKey === null),
    [scopedEvents],
  );

  const cancelTransition = () => {
    setPendingTransition(null);
    transitionTriggerRef.current?.focus({ preventScroll: true });
  };

  const renderDetails = (event: Event) => {

                const isSelected = selectedEventId === event.id;
                const eventTransition = pendingTransition?.scope === scope &&
                    pendingTransition.eventId === event.id &&
                    pendingTransition.fromState === event.state
                  ? pendingTransition
                  : null;
                const nextStates: EventState[] =
                  event.state === "draft"
                    ? ["open", "archived"]
                    : event.state === "open"
                      ? ["closed"]
                      : event.state === "closed"
                        ? ["archived"]
                        : [];
    return <div tabIndex={-1} ref={(element) => { if (element) eventCardRefs.current.set(event.id, element); else eventCardRefs.current.delete(event.id); }} className="space-y-4">
      {feedback && <Alert type={feedback.type} message={feedback.message} />}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-text-muted">
                          {t(`state.${event.state}`)} · {event.businessDate}
                        </p>
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
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => onSelectedEventChange(isSelected ? null : event.id)}
                        disabled={Boolean(busyId)}
                        className={`min-h-11 border px-3 py-2 text-xs font-semibold ${
                          isSelected
                            ? "border-border-strong bg-surface-active text-text-heading"
                            : "border-border-default bg-surface-raised text-text-body"
                        }`}
                      >
                        {isSelected ? t("selected") : t("useForOperations")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDetailId(null);
                          setFeedback(null);
                          setCreateOpen(true);
                          setName(`${event.name} ${t("copySuffix")}`.trim());
                          setCapacity(event.capacity?.toString() ?? "");
                          setTargetGuests(event.targetGuests?.toString() ?? "");
                          setTemplateSourceEventId(event.id);
                        }}
                        disabled={Boolean(busyId)}
                        className="min-h-11 border border-border-default bg-surface-raised px-3 py-2 text-xs font-semibold text-text-body"
                      >
                        {t("useTemplate")}
                      </button>
                      {nextStates.map((state) => (
                        <button
                          key={state}
                          type="button"
                          onClick={(clickEvent) => {
                            if (state === "closed" || state === "archived") {
                              transitionTriggerRef.current = clickEvent.currentTarget;
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
                          disabled={Boolean(busyId)}
                          className="min-h-11 border border-border-default bg-surface-raised px-3 py-2 text-xs font-semibold text-text-body disabled:opacity-50"
                        >
                          {t(`transition.${state}`)}
                        </button>
                      ))}
                    </div>
                    {eventTransition && (
                      <div
                        role="group"
                        aria-label={t(`transition.${eventTransition.nextState}`)}
                        className="mt-3 border-t border-border-default pt-3"
                        onKeyDown={(keyEvent) => {
                          if (keyEvent.key === "Escape") {
                            keyEvent.preventDefault();
                            keyEvent.stopPropagation();
                            cancelTransition();
                          }
                        }}
                      >
                        <p className="text-sm text-text-muted">
                          {t(`transitionConfirm.${eventTransition.nextState}`)}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-3">
                          <button
                            ref={cancelTransitionRef}
                            type="button"
                            onClick={cancelTransition}
                            disabled={Boolean(busyId)}
                            className="min-h-11 border border-border-default px-3 py-2 text-xs font-semibold text-text-body"
                          >
                            {t("cancel")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void transition(event, eventTransition.nextState)}
                            disabled={Boolean(busyId)}
                            className="min-h-11 border border-status-danger px-3 py-2 text-xs font-semibold text-status-danger disabled:opacity-50"
                          >
                            {t(`transition.${eventTransition.nextState}`)}
                          </button>
                        </div>
                      </div>
                    )}
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

      {feedback && <Alert type={feedback.type} message={feedback.message} />}

      <section className="record-collection" aria-labelledby="event-list-title">
        <PanelHeader
          title={t("listTitle")}
          headingId="event-list-title"
          actions={<Button aria-expanded={createOpen} aria-controls={createOpen ? "event-create-panel" : undefined} onClick={() => { setFeedback(null); if (createOpen) requestSheetClose("event-create-panel"); else setCreateOpen(true); }} disabled={!venueId || Boolean(busyId)}>{t("createTitle")}</Button>}
          count={explicitEvents.length}
          onRefresh={loadEvents}
          isLoading={isLoading}
        />
      <Sheet id="event-create-panel" open={createOpen} title={t("createTitle")} onClose={() => {
        setCreateOpen(false); setName(""); setCapacity(""); setTargetGuests(""); setTemplateSourceEventId(null);
      }} dirty={Boolean(name || capacity || targetGuests)} busy={Boolean(busyId)}>
        {feedback && <Alert type={feedback.type} message={feedback.message} />}
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
            <button
              type="submit"
              disabled={!venueId || !name.trim() || Boolean(busyId)}
              className="min-h-11 bg-action-primary px-4 py-3 text-sm font-semibold text-action-text disabled:opacity-50"
            >
              {busyId === "create" ? t("creating") : t("create")}
            </button>
          </fieldset>
        </form>
      </Sheet>
        <div className="record-collection-body">
          {loadError && <Alert type="error" message={t("loadFailed")} />}
          {!venueId ? (
            <p className="border border-border-default bg-canvas p-4 text-sm text-text-muted">
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
                  <button type="button" className="record-open" onClick={() => { setFeedback(null); setDetailId(detailId === event.id ? null : event.id); setPendingTransition(null); }} disabled={Boolean(busyId)} aria-expanded={detailId === event.id} aria-controls={detailId === event.id ? `event-detail-${event.id}` : undefined}>
                    <span className="record-identity"><strong>{event.name}</strong><small>{event.businessDate}{selectedEventId === event.id ? ` · ${t("selected")}` : ""}</small></span>
                    <span className="record-value">{t("capacity")} {event.capacity ?? "—"}</span>
                    <span className="record-status">{t(`state.${event.state}`)}</span>
                  </button>
                </div>
                {detailId === event.id && <Sheet id={`event-detail-${event.id}`} title={event.name} presentation="detail" size="record" onClose={() => { setDetailId(null); setPendingTransition(null); }} busy={Boolean(busyId)}>
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

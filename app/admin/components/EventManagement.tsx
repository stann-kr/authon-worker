"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Alert from "@/components/Alert";
import DatePicker from "@/components/DatePicker";
import EmptyState from "@/components/EmptyState";
import PanelHeader from "@/components/PanelHeader";
import Skeleton from "@/components/Skeleton";
import VenueSelector, { useVenueSelector } from "@/components/VenueSelector";
import { formatVenueDateTime } from "@/lib/date";
import {
  createEvent,
  fetchEvents,
  transitionEventState,
} from "@/lib/api/events";
import type { Event, EventState } from "@/lib/api/types";
import { useLatestRequestGuard } from "@/lib/hooks";
import { deriveAsyncListState, shouldShowEmptyState } from "@/lib/ui/async-list-state";

interface EventManagementProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
  businessDate: string;
  selectedEventId: string | null;
  onSelectedEventChange: (eventId: string | null) => void;
  onEventsChanged: () => void;
}

const EMPTY_EVENTS: Event[] = [];

export default function EventManagement({
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
  const [events, setEvents] = useState<Event[]>([]);
  const [loadedScope, setLoadedScope] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
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
  }, [scope]);

  const scopedEvents = loadedScope === scope ? events : EMPTY_EVENTS;
  const listState = deriveAsyncListState({
    hasStarted: isLoading || loadedScope !== "",
    isLoading: isLoading || loadedScope !== scope,
    itemCount: scopedEvents.length,
    hasError: loadError,
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!venueId || busyId) return;
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
    const response = await createEvent(draft);
    if (response.error || !response.data) {
      setFeedback({ type: "error", message: t("createFailed") });
    } else {
      setName("");
      setCapacity("");
      setTargetGuests("");
      setTemplateSourceEventId(null);
      onSelectedEventChange(response.data.id);
      setFeedback({ type: "success", message: t("created") });
      await loadEvents();
      onEventsChanged();
    }
    setBusyId(null);
  };

  const transition = async (event: Event, nextState: EventState) => {
    setBusyId(event.id);
    setFeedback(null);
    const response = await transitionEventState(event.id, nextState);
    if (response.error || !response.data) {
      setFeedback({ type: "error", message: t("transitionFailed") });
    } else {
      setFeedback({ type: "success", message: t("stateChanged") });
      await loadEvents();
      onEventsChanged();
    }
    setBusyId(null);
  };

  const explicitEvents = useMemo(
    () => scopedEvents.filter((event) => event.compatibilityKey === null),
    [scopedEvents],
  );

  return (
    <div className="space-y-4">
      {isSuperAdmin && venues.length > 0 && (
        <VenueSelector
          venues={venues}
          selectedVenueId={selectedVenueId}
          onVenueChange={setSelectedVenueId}
          disabled={Boolean(busyId)}
          className="app-panel p-4 sm:p-5"
        />
      )}

      <div className="context-bar">
        <DatePicker
          value={selectedDate}
          onChange={onDateChange}
          businessDate={businessDate}
          disabled={Boolean(busyId)}
        />
      </div>

      {feedback && <Alert type={feedback.type} message={feedback.message} />}

      <section className="app-panel" aria-labelledby="event-create-title">
        <PanelHeader title={t("createTitle")} headingId="event-create-title" />
        <form onSubmit={submit} className="p-4 sm:p-5">
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
      </section>

      <section className="app-panel" aria-labelledby="event-list-title">
        <PanelHeader
          title={t("listTitle")}
          headingId="event-list-title"
          count={explicitEvents.length}
          onRefresh={loadEvents}
          isLoading={isLoading}
        />
        <div className="p-4 sm:p-5">
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
            <div className="grid gap-3 lg:grid-cols-2">
              {explicitEvents.map((event) => {
                const isSelected = selectedEventId === event.id;
                const nextStates: EventState[] =
                  event.state === "draft"
                    ? ["open", "archived"]
                    : event.state === "open"
                      ? ["closed"]
                      : event.state === "closed"
                        ? ["archived"]
                        : [];
                return (
                  <article key={event.id} className="border border-border-default bg-canvas p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="type-row-title break-words">{event.name}</h3>
                        <p className="mt-1 text-xs text-text-muted">
                          {t(`state.${event.state}`)} · {event.businessDate}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono text-xs text-text-muted">
                        {event.capacity ?? "—"}
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
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => onSelectedEventChange(isSelected ? null : event.id)}
                        disabled={Boolean(busyId)}
                        className={`min-h-11 border px-3 py-2 text-xs font-semibold ${
                          isSelected
                            ? "border-action-primary bg-surface-active text-text-heading"
                            : "border-border-default bg-surface-raised text-text-body"
                        }`}
                      >
                        {isSelected ? t("selected") : t("useForOperations")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
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
                          onClick={() => void transition(event, state)}
                          disabled={Boolean(busyId)}
                          className="min-h-11 border border-border-default bg-surface-raised px-3 py-2 text-xs font-semibold text-text-body disabled:opacity-50"
                        >
                          {t(`transition.${state}`)}
                        </button>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

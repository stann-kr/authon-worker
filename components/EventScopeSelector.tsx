"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/Icon";
import { fetchEvents } from "@/lib/events/client";
import type { Event } from "@/lib/events/types";
import { useLatestRef, useLatestRequestGuard } from "@/lib/hooks";

interface EventScopeSelectorProps {
  venueId: string | null | undefined;
  businessDate: string;
  value: string | null;
  onChange: (eventId: string | null) => void;
  disabled?: boolean;
  reloadKey?: number;
  className?: string;
  renderScope?: (control: ReactNode, label: string) => ReactNode;
  /** Adds a whole-day choice above the Events; `value` is ignored while it is selected. */
  allEventsOption?: { selected: boolean; onSelect: () => void };
  /** Receives the date's explicit Events whenever they load. */
  onEventsLoaded?: (events: Event[]) => void;
}

const ALL_EVENTS_VALUE = "__all_events__";

export default function EventScopeSelector({
  venueId,
  businessDate,
  value,
  onChange,
  disabled = false,
  reloadKey = 0,
  className = "",
  renderScope,
  allEventsOption,
  onEventsLoaded,
}: EventScopeSelectorProps) {
  const t = useTranslations("EventScope");
  const commonT = useTranslations("Common");
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const requestGuard = useLatestRequestGuard();
  const valueRef = useLatestRef(value);
  const onChangeRef = useLatestRef(onChange);
  const onEventsLoadedRef = useLatestRef(onEventsLoaded);

  const loadEvents = useCallback(async () => {
    const isLatest = requestGuard.beginRequest();
    if (!venueId) {
      setEvents([]);
      setHasError(false);
      setIsLoading(false);
      onEventsLoadedRef.current?.([]);
      if (valueRef.current) onChangeRef.current(null);
      return;
    }
    setIsLoading(true);
    setHasError(false);
    try {
      const response = await fetchEvents({ venueId, businessDate });
      if (!isLatest()) return;
      if (response.error || !response.data) throw new Error("EVENT_LIST_FAILED");
      const explicitEvents = response.data.filter(
        (event) => event.compatibilityKey === null,
      );
      setEvents(explicitEvents);
      onEventsLoadedRef.current?.(explicitEvents);
      if (valueRef.current && !explicitEvents.some((event) => event.id === valueRef.current)) {
        onChangeRef.current(null);
      }
    } catch {
      if (!isLatest()) return;
      setEvents([]);
      setHasError(true);
    } finally {
      if (isLatest()) setIsLoading(false);
    }
  }, [businessDate, onChangeRef, onEventsLoadedRef, requestGuard, valueRef, venueId]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents, reloadKey]);

  const options = useMemo(
    () =>
      events.map((event) => ({
        ...event,
        label: `${event.name} · ${t(`state.${event.state}`)}`,
      })),
    [events, t],
  );

  const control = (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor="event-scope-selector" className="type-context-title">
        {t("label")}
      </label>
      <div className="relative">
        <select
          id="event-scope-selector"
          name="event-scope"
          value={allEventsOption?.selected ? ALL_EVENTS_VALUE : value ?? ""}
          onChange={(event) => {
            if (allEventsOption && event.target.value === ALL_EVENTS_VALUE) allEventsOption.onSelect();
            else onChange(event.target.value || null);
          }}
          disabled={disabled || !venueId || isLoading}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? "event-scope-error" : undefined}
          className="app-field min-h-11 appearance-none pr-10"
        >
          {allEventsOption && <option value={ALL_EVENTS_VALUE}>{t("allEvents")}</option>}
          <option value="">{t("generalRoster")}</option>
          {options.map((event) => (
            <option key={event.id} value={event.id}>
              {event.label}
            </option>
          ))}
        </select>
        <Icon
          name="chevron-down"
          size={18}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
        />
      </div>
      {hasError && (
        <div
          id="event-scope-error"
          className="mt-2 flex items-center justify-between gap-3 text-xs text-status-danger"
        >
          <span>{t("loadFailed")}</span>
          <button
            type="button"
            onClick={() => void loadEvents()}
            className="min-h-11 shrink-0 underline underline-offset-4"
          >
            {t("retry")}
          </button>
        </div>
      )}
    </div>
  );
  const label = hasError ? t("loadFailed") : allEventsOption?.selected ? t("allEvents") : events.find((event) => event.id === value)?.name ??
    (value ? commonT("loading") : t("generalRoster"));
  return renderScope ? renderScope(control, label) : control;
}

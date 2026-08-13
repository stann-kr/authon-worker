"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/Icon";
import { fetchEvents } from "@/lib/api/events";
import type { Event } from "@/lib/api/types";
import { useLatestRequestGuard } from "@/lib/hooks";

interface EventScopeSelectorProps {
  venueId: string | null | undefined;
  businessDate: string;
  value: string | null;
  onChange: (eventId: string | null) => void;
  disabled?: boolean;
  reloadKey?: number;
  className?: string;
}

export default function EventScopeSelector({
  venueId,
  businessDate,
  value,
  onChange,
  disabled = false,
  reloadKey = 0,
  className = "",
}: EventScopeSelectorProps) {
  const t = useTranslations("EventScope");
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const requestGuard = useLatestRequestGuard();

  const loadEvents = useCallback(async () => {
    const isLatest = requestGuard.beginRequest();
    if (!venueId) {
      setEvents([]);
      setHasError(false);
      setIsLoading(false);
      onChange(null);
      return;
    }
    setIsLoading(true);
    setHasError(false);
    const response = await fetchEvents({ venueId, businessDate });
    if (!isLatest()) return;
    if (response.error || !response.data) {
      setEvents([]);
      setHasError(true);
      setIsLoading(false);
      return;
    }
    const explicitEvents = response.data.filter(
      (event) => event.compatibilityKey === null,
    );
    setEvents(explicitEvents);
    if (value && !explicitEvents.some((event) => event.id === value)) {
      onChange(null);
    }
    setIsLoading(false);
  }, [businessDate, onChange, requestGuard, venueId, value]);

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

  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor="event-scope-selector" className="type-context-title">
        {t("label")}
      </label>
      <div className="relative">
        <select
          id="event-scope-selector"
          name="event-scope"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value || null)}
          disabled={disabled || !venueId || isLoading}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? "event-scope-error" : undefined}
          className="app-field min-h-11 appearance-none pr-10"
        >
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
}

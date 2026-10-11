"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Alert from "@/components/Alert";
import Button from "@/components/Button";
import DisclosureSection from "@/components/DisclosureSection";
import EmptyState from "@/components/EmptyState";
import VenueSelector, { useVenueSelector } from "@/components/VenueSelector";
import { fetchAdminAnalytics } from "@/lib/api/analytics";
import { getBusinessDate } from "@/lib/date";
import { useLatestRequestGuard } from "@/lib/hooks";
import {
  getAdminAnalyticsSearch,
  parseAdminAnalyticsUrlState,
  type AdminAnalyticsUrlState,
} from "@/lib/analytics/url-state";
import type { AdminAnalyticsView, AnalyticsGranularity } from "@/lib/analytics/types";
import AnalyticsContributors from "./analytics/AnalyticsContributors";
import AnalyticsAttendance from "./analytics/AnalyticsAttendance";
import AnalyticsEvents from "./analytics/AnalyticsEvents";
import AnalyticsPeriodBar from "./analytics/AnalyticsPeriodBar";
import AnalyticsSkeleton from "./analytics/AnalyticsSkeleton";
import AnalyticsSummary from "./analytics/AnalyticsSummary";
import AnalyticsTrend from "./analytics/AnalyticsTrend";

export default function AdminAnalytics({
  onOpenEvent,
}: {
  onOpenEvent: (eventId: string, businessDate: string) => void;
}) {
  const t = useTranslations("AdminAnalytics");
  const {
    venueId,
    venues,
    selectedVenueId,
    setSelectedVenueId,
    currentVenue,
    isSuperAdmin,
    isLoadingVenues,
  } = useVenueSelector();
  const businessDate = getBusinessDate(currentVenue ?? {});
  const [urlState, setUrlState] = useState<AdminAnalyticsUrlState>({
    granularity: "month",
    anchorDate: getBusinessDate(),
  });
  const [isUrlReady, setIsUrlReady] = useState(false);
  const [view, setView] = useState<AdminAnalyticsView | null>(null);
  const [loadedScope, setLoadedScope] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestGuard = useLatestRequestGuard();
  const scope = `${venueId}:${urlState.granularity}:${urlState.anchorDate}`;

  const applyUrlState = useCallback(
    (nextState: AdminAnalyticsUrlState, mode: "push" | "replace") => {
      const nextSearch = getAdminAnalyticsSearch(nextState);
      const nextUrl = `/admin${nextSearch}`;
      if (mode === "replace") {
        window.history.replaceState(null, "", nextUrl);
      } else {
        window.history.pushState(null, "", nextUrl);
      }
      setUrlState(nextState);
    },
    [],
  );

  useEffect(() => {
    if (!currentVenue) return;
    const nextState = parseAdminAnalyticsUrlState(
      new URLSearchParams(window.location.search),
      businessDate,
    );
    const canonicalSearch = getAdminAnalyticsSearch(nextState);
    setUrlState(nextState);
    if (window.location.search !== canonicalSearch) {
      window.history.replaceState(null, "", `/admin${canonicalSearch}`);
    }
    setIsUrlReady(true);
  }, [businessDate, currentVenue]);

  useEffect(() => {
    if (!isUrlReady) return;
    const handlePopState = () => {
      setUrlState(
        parseAdminAnalyticsUrlState(
          new URLSearchParams(window.location.search),
          businessDate,
        ),
      );
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [businessDate, isUrlReady]);

  const loadAnalytics = useCallback(async () => {
    const isLatest = requestGuard.beginRequest();
    if (!venueId || !isUrlReady) {
      setView(null);
      setLoadedScope(scope);
      setLoadError(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    const response = await fetchAdminAnalytics({
      venueId,
      granularity: urlState.granularity,
      anchorDate: urlState.anchorDate,
      compare: "previous",
    });
    if (!isLatest()) return;
    if (response.error || !response.data) {
      setView(null);
      setLoadError(response.error ?? "ANALYTICS_LOAD_FAILED");
    } else {
      setView(response.data);
    }
    setLoadedScope(scope);
    setIsLoading(false);
  }, [isUrlReady, requestGuard, scope, urlState.anchorDate, urlState.granularity, venueId]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const scopedView = loadedScope === scope ? view : null;
  const isScopeLoading = isLoading || loadedScope !== scope;
  // A period refetch keeps the same venue's last result on screen, dimmed, instead of a skeleton.
  const displayView = scopedView ?? (
    isScopeLoading && loadedScope.startsWith(`${venueId}:`) ? view : null
  );
  const hasCloseoutIntegrityWarning =
    (displayView?.coverage.driftedEvents ?? 0) > 0;
  const hasNoRegistrations = displayView?.coverage.operatingDays === 0;
  const changeGranularity = (granularity: AnalyticsGranularity) => {
    if (granularity === urlState.granularity) return;
    applyUrlState({ granularity, anchorDate: urlState.anchorDate }, "push");
  };
  const changeAnchorDate = (anchorDate: string) => {
    applyUrlState({ ...urlState, anchorDate }, "push");
  };
  const errorMessage =
    loadError === "INVALID_ANALYTICS_QUERY"
      ? t("invalidPeriod")
      : loadError === "FORBIDDEN" || loadError === "VENUE_UNAVAILABLE"
        ? t("venueUnavailable")
        : t("loadFailed");

  return (
    <div className="space-y-4">
      {isSuperAdmin && venues.length > 0 && (
        <VenueSelector
          venues={venues}
          selectedVenueId={selectedVenueId}
          onVenueChange={setSelectedVenueId}
          className="record-scope-selector"
        />
      )}

      <header>
        <h3 className="sr-only">
          {t("title")}
        </h3>
        <p className="max-w-[70ch] text-sm leading-relaxed text-text-muted">
          {t("description")}
        </p>
      </header>

      <AnalyticsPeriodBar
        granularity={urlState.granularity}
        view={displayView}
        isLoading={isScopeLoading}
        anchorDate={urlState.anchorDate}
        onGranularityChange={changeGranularity}
        onAnchorDateChange={changeAnchorDate}
        onRefresh={loadAnalytics}
      />

      {!venueId && !isLoadingVenues ? (
        <section className="app-panel">
          <EmptyState icon="store" message={t("selectVenue")} />
        </section>
      ) : isScopeLoading && !displayView ? (
        <AnalyticsSkeleton label={t("loading")} />
      ) : loadError || !displayView ? (
        <section className="app-panel p-4 sm:p-5">
          <Alert type="error" message={errorMessage} />
          <Button variant="secondary" onClick={loadAnalytics} className="mt-3">
            {t("retry")}
          </Button>
        </section>
      ) : (
        <div
          className={`space-y-4 transition-opacity duration-150 ${isScopeLoading ? "opacity-60" : ""}`}
          aria-busy={isScopeLoading}
        >
          {hasCloseoutIntegrityWarning && (
            <aside className="rounded-panel border border-transparent bg-status-waiting/10 p-4 text-sm leading-relaxed text-status-waiting" role="status">
              {t("coverage.partial")}
            </aside>
          )}

          {hasNoRegistrations ? (
            <>
              {/* One empty state replaces the all-zero registration cards. */}
              <section className="app-panel">
                <EmptyState icon="chart-line" message={t("empty.title")} description={t("empty.description")} />
              </section>
              {displayView.attendance.trend.length > 0 && (
                <AnalyticsAttendance attendance={displayView.attendance} />
              )}
            </>
          ) : (
            <>
              <AnalyticsSummary summary={displayView.summary} />
              <AnalyticsAttendance attendance={displayView.attendance} />
              <AnalyticsTrend points={displayView.trend} />
              {displayView.contributors.length > 0 ? (
                <AnalyticsContributors rows={displayView.contributors} />
              ) : (
                <section className="app-panel">
                  <EmptyState
                    icon="users"
                    message={t("contributors.emptyTitle")}
                    description={t("contributors.emptyDescription")}
                  />
                </section>
              )}
              {displayView.events.length > 0 && (
                <AnalyticsEvents
                  rows={displayView.events}
                  venueId={venueId}
                  onOpenEvent={onOpenEvent}
                />
              )}
            </>
          )}

          <div className="app-panel px-4 py-2 sm:px-5">
            <DisclosureSection title={t("basisTitle")} className="mt-0 border-t-0">
              <div className="space-y-3 text-xs leading-relaxed text-text-muted">
                <p>{t("dataBasis")}</p>
                <p>{t("summary.registrationDefinition")}</p>
                <p>{t("attendance.definition")}</p>
                <p>{t("contributors.description")}</p>
                <p>{t("trend.description")}</p>
              </div>
            </DisclosureSection>
            <DisclosureSection title={t("coverage.title")}>
              <dl className="grid grid-cols-2 gap-px bg-border-subtle sm:grid-cols-4">
                {([
                  ["confirmed", displayView.coverage.confirmedEvents],
                  ["operatingDays", displayView.coverage.operatingDays],
                  ["unconfirmed", displayView.coverage.unconfirmedClosedEvents],
                  ["open", displayView.coverage.openEvents],
                  ["draft", displayView.coverage.draftEvents],
                  ["drifted", displayView.coverage.driftedEvents],
                  ["legacy", displayView.coverage.legacyEvents],
                  ["mapped", displayView.coverage.mappedContributorPercent],
                ] as const).map(([key, value]) => (
                  <div key={key} className="bg-surface p-4 text-center">
                    <dt className="text-xs leading-tight text-text-muted">{t(`coverage.${key}`)}</dt>
                    <dd className="mt-2 font-mono text-lg tabular-nums text-text-heading">
                      {value === null ? "—" : `${value}${key === "mapped" ? "%" : ""}`}
                    </dd>
                  </div>
                ))}
              </dl>
            </DisclosureSection>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Alert from "@/components/Alert";
import Button from "@/components/Button";
import EmptyState from "@/components/EmptyState";
import Skeleton from "@/components/Skeleton";
import VenueSelector, { useVenueSelector } from "@/components/VenueSelector";
import { useSectionLoadingTask } from "@/components/RouteTransitionProvider";
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
import AnalyticsEvents from "./analytics/AnalyticsEvents";
import AnalyticsPeriodBar from "./analytics/AnalyticsPeriodBar";
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
  useSectionLoadingTask(
    isLoadingVenues || (Boolean(venueId) && (isLoading || !isUrlReady)),
  );

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
  const hasCloseoutIntegrityWarning =
    (scopedView?.coverage.driftedEvents ?? 0) > 0;
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
          className="app-panel p-4 sm:p-5"
        />
      )}

      <header className="border-b border-border-subtle pb-4">
        <h3 className="text-xl font-semibold tracking-[-0.02em] text-text-heading">
          {t("title")}
        </h3>
        <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-text-muted">
          {t("description")}
        </p>
      </header>

      <AnalyticsPeriodBar
        granularity={urlState.granularity}
        view={scopedView}
        isLoading={isScopeLoading}
        onGranularityChange={changeGranularity}
        onAnchorDateChange={changeAnchorDate}
        onRefresh={loadAnalytics}
      />

      {!venueId && !isLoadingVenues ? (
        <section className="app-panel">
          <EmptyState icon="store" message={t("selectVenue")} />
        </section>
      ) : isScopeLoading ? (
        <section className="app-panel p-4 sm:p-5" aria-label={t("loading")} aria-busy="true">
          <Skeleton rows={7} />
        </section>
      ) : loadError || !scopedView ? (
        <section className="app-panel p-4 sm:p-5">
          <Alert type="error" message={errorMessage} />
          <Button variant="secondary" onClick={loadAnalytics} className="mt-3">
            {t("retry")}
          </Button>
        </section>
      ) : (
        <>
          {hasCloseoutIntegrityWarning && (
            <aside className="border border-status-waiting/70 bg-status-waiting/10 p-4 text-sm leading-relaxed text-status-waiting" role="status">
              {t("coverage.partial")}
            </aside>
          )}
          <AnalyticsSummary summary={scopedView.summary} />
          <section className="app-panel" aria-labelledby="analytics-coverage-title">
            <div className="border-b border-border-subtle px-4 py-3 sm:px-5">
              <h3 id="analytics-coverage-title" className="type-panel-title">{t("coverage.title")}</h3>
            </div>
            <dl className="grid grid-cols-2 gap-px bg-border-subtle sm:grid-cols-3 xl:grid-cols-6">
              {([
                ["confirmed", scopedView.coverage.confirmedEvents],
                ["operatingDays", scopedView.coverage.operatingDays],
                ["unconfirmed", scopedView.coverage.unconfirmedClosedEvents],
                ["open", scopedView.coverage.openEvents],
                ["draft", scopedView.coverage.draftEvents],
                ["drifted", scopedView.coverage.driftedEvents],
                ["legacy", scopedView.coverage.legacyEvents],
                ["mapped", scopedView.coverage.mappedContributorPercent],
              ] as const).map(([key, value]) => (
                <div key={key} className="bg-surface p-4 text-center">
                  <dt className="text-xs leading-tight text-text-muted">{t(`coverage.${key}`)}</dt>
                  <dd className="mt-2 font-mono text-lg tabular-nums text-text-heading">
                    {value === null ? "—" : `${value}${key === "mapped" ? "%" : ""}`}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {scopedView.coverage.operatingDays === 0 ? (
            <section className="app-panel">
              <EmptyState icon="chart-line" message={t("empty.title")} description={t("empty.description")} />
            </section>
          ) : (
            <>
              <AnalyticsTrend points={scopedView.trend} />
              {scopedView.contributors.length > 0 ? (
                <AnalyticsContributors rows={scopedView.contributors} />
              ) : (
                <section className="app-panel">
                  <EmptyState
                    icon="users"
                    message={t("contributors.emptyTitle")}
                    description={t("contributors.emptyDescription")}
                  />
                </section>
              )}
              {scopedView.events.length > 0 && (
                <AnalyticsEvents
                  rows={scopedView.events}
                  venueId={venueId}
                  onOpenEvent={onOpenEvent}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

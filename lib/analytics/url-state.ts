import { isBusinessDate } from "../events/domain.ts";
import { isAnalyticsGranularity } from "./period.ts";
import type { AnalyticsGranularity } from "./types.ts";

export interface AdminAnalyticsUrlState {
  granularity: AnalyticsGranularity;
  anchorDate: string;
}

function anchorFromPeriod(
  granularity: AnalyticsGranularity,
  period: string | null,
): string | null {
  if (!period) return null;
  if (granularity === "month" && /^\d{4}-\d{2}$/.test(period)) {
    const value = `${period}-01`;
    return isBusinessDate(value) ? value : null;
  }
  if (granularity === "quarter") {
    const match = /^(\d{4})-Q([1-4])$/.exec(period);
    if (!match) return null;
    return `${match[1]}-${String((Number(match[2]) - 1) * 3 + 1).padStart(2, "0")}-01`;
  }
  if (granularity === "year" && /^\d{4}$/.test(period)) {
    return `${period}-01-01`;
  }
  return null;
}

function periodFromAnchor(
  granularity: AnalyticsGranularity,
  anchorDate: string,
): string {
  if (granularity === "month") return anchorDate.slice(0, 7);
  if (granularity === "year") return anchorDate.slice(0, 4);
  const quarter = Math.floor((Number(anchorDate.slice(5, 7)) - 1) / 3) + 1;
  return `${anchorDate.slice(0, 4)}-Q${quarter}`;
}

export function parseAdminAnalyticsUrlState(
  searchParams: Pick<URLSearchParams, "get">,
  defaultAnchorDate: string,
): AdminAnalyticsUrlState {
  if (!isBusinessDate(defaultAnchorDate)) {
    throw new RangeError("Invalid analytics URL default date");
  }
  const requestedGranularity = searchParams.get("grain");
  const granularity = isAnalyticsGranularity(requestedGranularity)
    ? requestedGranularity
    : "month";
  return {
    granularity,
    anchorDate:
      anchorFromPeriod(granularity, searchParams.get("period")) ??
      defaultAnchorDate,
  };
}

export function getAdminAnalyticsSearch(
  state: AdminAnalyticsUrlState,
): string {
  if (
    !isAnalyticsGranularity(state.granularity) ||
    !isBusinessDate(state.anchorDate)
  ) {
    throw new RangeError("Invalid analytics URL state");
  }
  const search = new URLSearchParams({
    tab: "analytics",
    grain: state.granularity,
    period: periodFromAnchor(state.granularity, state.anchorDate),
    compare: "previous",
  });
  return `?${search.toString()}`;
}

export type ManageFilter =
  | "all"
  | "active"
  | "attention";

export type ManageSort =
  | "expiresSoonest"
  | "newest"
  | "djName";

interface LinkStatusInput {
  active: boolean;
  expiresAt?: string | null;
  usedGuests: number;
  maxGuests: number;
  createdAt?: string | null;
  djName?: string | null;
}

export interface DerivedLinkStatus {
  expired: boolean;
  expiringSoon: boolean;
  full: boolean;
  active: boolean;
  inactive: boolean;
  usagePercent: number;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function getExpiryTime(expiresAt?: string | null): number | null {
  if (!expiresAt) return null;
  const time = new Date(expiresAt).getTime();
  return Number.isNaN(time) ? null : time;
}

function getCreatedTime(createdAt?: string | null): number {
  if (!createdAt) return 0;
  const time = new Date(createdAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function isExpired(expiresAt?: string | null, now = Date.now()): boolean {
  const expiryTime = getExpiryTime(expiresAt);
  return expiryTime !== null && expiryTime <= now;
}

export function isExpiringSoon(expiresAt?: string | null, now = Date.now()): boolean {
  const expiryTime = getExpiryTime(expiresAt);
  if (expiryTime === null) return false;
  const delta = expiryTime - now;
  return delta > 0 && delta <= DAY_MS;
}

export function formatRelativeExpiry(
  expiresAt?: string | null,
  now = Date.now(),
  labels: {
    noExpiry?: string;
    invalidExpiry?: string;
    expiredAgo?: (duration: string) => string;
    expiresIn?: (duration: string) => string;
    formatDuration?: (parts: { days: number; hours: number; minutes: number }) => string;
  } = {},
): string {
  if (!expiresAt) return labels.noExpiry ?? "NO EXPIRY";

  const expiryTime = getExpiryTime(expiresAt);
  if (expiryTime === null) return labels.invalidExpiry ?? "INVALID EXPIRY";

  const delta = expiryTime - now;
  const absDelta = Math.abs(delta);
  const totalMinutes =
    absDelta === 0 ? 0 : Math.max(1, Math.floor(absDelta / MINUTE_MS));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  const compact = labels.formatDuration?.({ days, hours, minutes }) ?? (
    days > 0
      ? `${days}D ${hours}H`
      : hours > 0
        ? `${hours}H ${minutes}M`
        : `${minutes}M`
  );

  return delta <= 0
    ? labels.expiredAgo?.(compact) ?? `EXPIRED ${compact} AGO`
    : labels.expiresIn?.(compact) ?? `EXPIRES IN ${compact}`;
}

export function formatExpiryTimestamp(expiresAt?: string | null): string {
  return formatTimestamp(expiresAt, "No expiry", "Invalid expiry");
}

export function formatTimestamp(
  value?: string | null,
  emptyLabel = "Unknown",
  invalidLabel = "Invalid timestamp",
  locale = "en-US",
): string {
  if (!value) return emptyLabel;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return invalidLabel;

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function deriveLinkStatus(
  link: LinkStatusInput,
  now = Date.now(),
): DerivedLinkStatus {
  const expired = isExpired(link.expiresAt, now);
  const expiringSoon = !expired && isExpiringSoon(link.expiresAt, now);
  const full = link.maxGuests <= 0 || link.usedGuests >= link.maxGuests;
  const active = link.active && !expired;
  const inactive = !link.active && !expired;
  const usagePercent =
    link.maxGuests <= 0
      ? 100
      : Math.min((link.usedGuests / link.maxGuests) * 100, 100);

  return {
    expired,
    expiringSoon,
    full,
    active,
    inactive,
    usagePercent,
  };
}

export function getDashboardStats<T extends LinkStatusInput>(
  links: T[],
  now = Date.now(),
) {
  return links.reduce(
    (stats, link) => {
      const status = deriveLinkStatus(link, now);
      const needsAttention =
        status.inactive || status.expired || status.expiringSoon || status.full;
      return {
        total: stats.total + 1,
        active: stats.active + (status.active ? 1 : 0),
        inactive: stats.inactive + (status.inactive ? 1 : 0),
        expired: stats.expired + (status.expired ? 1 : 0),
        expiringSoon: stats.expiringSoon + (status.expiringSoon ? 1 : 0),
        full: stats.full + (status.full ? 1 : 0),
        attention: stats.attention + (needsAttention ? 1 : 0),
      };
    },
    {
      total: 0,
      active: 0,
      inactive: 0,
      expired: 0,
      expiringSoon: 0,
      full: 0,
      attention: 0,
    },
  );
}

export function filterLinksByManageFilter<T extends LinkStatusInput>(
  links: T[],
  manageFilter: ManageFilter,
  now = Date.now(),
): T[] {
  if (manageFilter === "all") return links;

  return links.filter((link) => {
    const status = deriveLinkStatus(link, now);
    if (manageFilter === "active") return status.active;
    return status.inactive || status.expired || status.expiringSoon || status.full;
  });
}

export function sortLinks<T extends LinkStatusInput>(
  links: T[],
  sortBy: ManageSort,
  locale?: string,
): T[] {
  return [...links].sort((a, b) => {
    const expiryA = getExpiryTime(a.expiresAt) ?? Number.POSITIVE_INFINITY;
    const expiryB = getExpiryTime(b.expiresAt) ?? Number.POSITIVE_INFINITY;

    switch (sortBy) {
      case "expiresSoonest":
        return expiryA - expiryB;
      case "newest":
        return getCreatedTime(b.createdAt) - getCreatedTime(a.createdAt);
      case "djName":
        return (a.djName ?? "").localeCompare(b.djName ?? "", locale, {
          sensitivity: "base",
        });
      default:
        return 0;
    }
  });
}

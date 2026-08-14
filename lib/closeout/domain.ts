export type CloseoutGuestStatus = "pending" | "checked" | "deleted";

export interface CloseoutGuestInput {
  id: string;
  status: CloseoutGuestStatus;
  createdByUserId?: string | null;
  externalLinkId?: string | null;
  createdAt: string;
}

export interface CloseoutActivityInput {
  guestId: string;
  action: string;
  outcome: string;
  nextStatus?: string | null;
  channel: string;
  occurredAt: string;
  sequence?: number;
}

export interface CloseoutContributorInput {
  kind: "user" | "external_link";
  id: string;
  label: string;
  baseLimit: number | null;
  approvedExtra?: number;
}

export interface CloseoutEventInput {
  id: string;
  state: "draft" | "open" | "closed" | "archived";
  doorOpensAt: string | null;
  createdAt: string;
  openedAt: string | null;
  closedAt: string | null;
}

export interface CloseoutContributorMetric {
  kind: "user" | "external_link" | "unattributed";
  id: string | null;
  label: string;
  registered: number;
  checkedIn: number;
  noShow: number;
  entryRatePercent: number;
  sampleSize: number;
  baseLimit: number | null;
  approvedExtra: number;
  effectiveLimit: number | null;
  used: number;
  remaining: number | null;
}

export interface NightCloseoutReport {
  eventId: string;
  status: "provisional" | "ready" | "confirmed" | "inconsistent";
  registered: number;
  checkedIn: number;
  noShow: number;
  entryRatePercent: number;
  guestRemovals: number;
  checkInCancellations: number;
  reEntries: number;
  onSiteAdds: number;
  peak15Minutes: { startedAt: string; entries: number } | null;
  contributors: CloseoutContributorMetric[];
  ledger: {
    sourceActivityCount: number;
    coveredGuestCount: number;
    untrackedGuestCount: number;
    invariantMismatchCount: number;
  };
  timing: {
    openedAt: string | null;
    closedAt: string | null;
    confirmedAt: string | null;
    preparationSeconds: number | null;
    confirmationSeconds: number | null;
  };
}

function ratePercent(checkedIn: number, registered: number): number {
  if (registered === 0) return 0;
  return Math.round((checkedIn / registered) * 1000) / 10;
}

function secondsBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
    return null;
  }
  return Math.floor((endTime - startTime) / 1000);
}

function bucket15Minutes(timestamp: string): string | null {
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return null;
  const bucket = Math.floor(time / (15 * 60 * 1000)) * 15 * 60 * 1000;
  return new Date(bucket).toISOString();
}

function replayStatus(
  previous: CloseoutGuestStatus | null | undefined,
  activity: CloseoutActivityInput,
): CloseoutGuestStatus | null | undefined {
  switch (activity.action) {
    case "add":
      return activity.nextStatus === "checked" ? "checked" : "pending";
    case "update":
      return activity.nextStatus === "pending" ||
        activity.nextStatus === "checked" ||
        activity.nextStatus === "deleted"
        ? activity.nextStatus
        : previous;
    case "delete":
      return "deleted";
    case "restore":
      return activity.nextStatus === "checked" ? "checked" : "pending";
    case "permanent_delete":
      return null;
    case "check_in":
    case "re_entry":
      return "checked";
    case "cancel_check_in":
      return "pending";
    default:
      return previous;
  }
}

function contributorKey(
  guest: CloseoutGuestInput,
): { key: string; kind: CloseoutContributorMetric["kind"]; id: string | null } {
  if (guest.externalLinkId) {
    return {
      key: `external_link:${guest.externalLinkId}`,
      kind: "external_link",
      id: guest.externalLinkId,
    };
  }
  if (guest.createdByUserId) {
    return {
      key: `user:${guest.createdByUserId}`,
      kind: "user",
      id: guest.createdByUserId,
    };
  }
  return { key: "unattributed", kind: "unattributed", id: null };
}

export function buildNightCloseout(params: {
  event: CloseoutEventInput;
  guests: readonly CloseoutGuestInput[];
  activities: readonly CloseoutActivityInput[];
  contributors?: readonly CloseoutContributorInput[];
  confirmedAt?: string | null;
}): NightCloseoutReport {
  const appliedActivities = params.activities
    .filter((activity) => activity.outcome === "applied")
    .sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      (left.sequence ?? 0) - (right.sequence ?? 0) ||
      left.guestId.localeCompare(right.guestId),
    );
  const guestsById = new Map(params.guests.map((guest) => [guest.id, guest]));
  const replayed = new Map<string, CloseoutGuestStatus | null | undefined>();
  const coveredGuestIds = new Set<string>();

  for (const activity of appliedActivities) {
    const next = replayStatus(replayed.get(activity.guestId), activity);
    if (next !== undefined) {
      replayed.set(activity.guestId, next);
      coveredGuestIds.add(activity.guestId);
    }
  }

  let invariantMismatchCount = 0;
  for (const guestId of coveredGuestIds) {
    const expected = replayed.get(guestId);
    const current = guestsById.get(guestId)?.status ?? null;
    if (expected !== current) invariantMismatchCount += 1;
  }

  const activeGuests = params.guests.filter((guest) => guest.status !== "deleted");
  const checkedIn = activeGuests.filter((guest) => guest.status === "checked").length;
  const peakBuckets = new Map<string, number>();
  for (const activity of appliedActivities) {
    if (activity.action !== "check_in" && activity.action !== "re_entry") continue;
    const bucket = bucket15Minutes(activity.occurredAt);
    if (bucket) peakBuckets.set(bucket, (peakBuckets.get(bucket) ?? 0) + 1);
  }
  const peak15Minutes = [...peakBuckets.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([startedAt, entries]) => ({ startedAt, entries }))[0] ?? null;

  const descriptorMap = new Map(
    (params.contributors ?? []).map((contributor) => [
      `${contributor.kind}:${contributor.id}`,
      contributor,
    ]),
  );
  const contributorGuests = new Map<string, {
    kind: CloseoutContributorMetric["kind"];
    id: string | null;
    guests: CloseoutGuestInput[];
  }>();
  for (const guest of activeGuests) {
    const scope = contributorKey(guest);
    const current = contributorGuests.get(scope.key) ?? {
      kind: scope.kind,
      id: scope.id,
      guests: [],
    };
    current.guests.push(guest);
    contributorGuests.set(scope.key, current);
  }
  const contributors = [...contributorGuests.entries()]
    .map(([key, group]): CloseoutContributorMetric => {
      const descriptor = descriptorMap.get(key);
      const registered = group.guests.length;
      const groupCheckedIn = group.guests.filter(
        (guest) => guest.status === "checked",
      ).length;
      const baseLimit = descriptor?.baseLimit ?? null;
      const approvedExtra = descriptor?.approvedExtra ?? 0;
      const effectiveLimit = baseLimit === null ? null : baseLimit + approvedExtra;
      return {
        kind: group.kind,
        id: group.id,
        label: descriptor?.label ?? (group.kind === "unattributed" ? "Unattributed" : "Unknown"),
        registered,
        checkedIn: groupCheckedIn,
        noShow: registered - groupCheckedIn,
        entryRatePercent: ratePercent(groupCheckedIn, registered),
        sampleSize: registered,
        baseLimit,
        approvedExtra,
        effectiveLimit,
        used: registered,
        remaining:
          effectiveLimit === null ? null : Math.max(0, effectiveLimit - registered),
      };
    })
    .sort((left, right) =>
      right.checkedIn - left.checkedIn ||
      right.sampleSize - left.sampleSize ||
      left.label.localeCompare(right.label),
    );

  const confirmedAt = params.confirmedAt ?? null;
  let status: NightCloseoutReport["status"] = confirmedAt
    ? "confirmed"
    : params.event.state === "closed" || params.event.state === "archived"
      ? "ready"
      : "provisional";
  if (invariantMismatchCount > 0) status = "inconsistent";

  const doorOpenedAt = params.event.doorOpensAt ?? params.event.openedAt;
  const doorOpenedTime = doorOpenedAt ? new Date(doorOpenedAt).getTime() : null;

  return {
    eventId: params.event.id,
    status,
    registered: activeGuests.length,
    checkedIn,
    noShow: activeGuests.length - checkedIn,
    entryRatePercent: ratePercent(checkedIn, activeGuests.length),
    guestRemovals: appliedActivities.filter(
      (activity) => activity.action === "delete" || activity.action === "permanent_delete",
    ).length,
    checkInCancellations: appliedActivities.filter(
      (activity) => activity.action === "cancel_check_in",
    ).length,
    reEntries: appliedActivities.filter((activity) => activity.action === "re_entry").length,
    onSiteAdds:
      doorOpenedTime === null || !Number.isFinite(doorOpenedTime)
        ? 0
        : appliedActivities.filter((activity) =>
            activity.action === "add" &&
            ["admin", "door", "terminal"].includes(activity.channel) &&
            new Date(activity.occurredAt).getTime() >= doorOpenedTime,
          ).length,
    peak15Minutes,
    contributors,
    ledger: {
      sourceActivityCount: appliedActivities.length,
      coveredGuestCount: coveredGuestIds.size,
      untrackedGuestCount: params.guests.filter(
        (guest) => !coveredGuestIds.has(guest.id),
      ).length,
      invariantMismatchCount,
    },
    timing: {
      openedAt: params.event.openedAt,
      closedAt: params.event.closedAt,
      confirmedAt,
      preparationSeconds: secondsBetween(params.event.createdAt, params.event.openedAt),
      confirmationSeconds: secondsBetween(params.event.closedAt, confirmedAt),
    },
  };
}

function safeCsvCell(value: string | number | null): string {
  if (value === null) return "";
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function nightCloseoutToCsv(report: NightCloseoutReport): string {
  const header = [
    "scope",
    "kind",
    "label",
    "registered",
    "checked_in",
    "no_show",
    "entry_rate_percent",
    "sample_size",
    "base_limit",
    "approved_extra",
    "effective_limit",
    "used",
    "remaining",
    "guest_removals",
    "check_in_cancellations",
    "re_entries",
    "on_site_adds",
    "peak_15_started_at",
    "peak_15_entries",
    "preparation_seconds",
    "confirmation_seconds",
  ];
  const rows: Array<Array<string | number | null>> = [
    header,
    [
      "event",
      "summary",
      report.eventId,
      report.registered,
      report.checkedIn,
      report.noShow,
      report.entryRatePercent,
      report.registered,
      null,
      0,
      null,
      report.registered,
      null,
      report.guestRemovals,
      report.checkInCancellations,
      report.reEntries,
      report.onSiteAdds,
      report.peak15Minutes?.startedAt ?? null,
      report.peak15Minutes?.entries ?? null,
      report.timing.preparationSeconds,
      report.timing.confirmationSeconds,
    ],
    ...report.contributors.map((contributor) => [
      "contributor",
      contributor.kind,
      contributor.label,
      contributor.registered,
      contributor.checkedIn,
      contributor.noShow,
      contributor.entryRatePercent,
      contributor.sampleSize,
      contributor.baseLimit,
      contributor.approvedExtra,
      contributor.effectiveLimit,
      contributor.used,
      contributor.remaining,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]),
  ];
  return `${rows.map((row) => row.map(safeCsvCell).join(",")).join("\r\n")}\r\n`;
}

export function closeoutHashPayload(report: NightCloseoutReport): string {
  return JSON.stringify({
    eventId: report.eventId,
    registered: report.registered,
    checkedIn: report.checkedIn,
    noShow: report.noShow,
    guestRemovals: report.guestRemovals,
    checkInCancellations: report.checkInCancellations,
    reEntries: report.reEntries,
    onSiteAdds: report.onSiteAdds,
    peak15Minutes: report.peak15Minutes,
    contributors: [...report.contributors]
      .sort((left, right) =>
        `${left.kind}:${left.id ?? ""}`.localeCompare(
          `${right.kind}:${right.id ?? ""}`,
        ),
      )
      .map((contributor) => ({
        kind: contributor.kind,
        id: contributor.id,
        registered: contributor.registered,
        checkedIn: contributor.checkedIn,
        baseLimit: contributor.baseLimit,
        approvedExtra: contributor.approvedExtra,
      })),
    sourceActivityCount: report.ledger.sourceActivityCount,
    coveredGuestCount: report.ledger.coveredGuestCount,
    untrackedGuestCount: report.ledger.untrackedGuestCount,
    invariantMismatchCount: report.ledger.invariantMismatchCount,
  });
}

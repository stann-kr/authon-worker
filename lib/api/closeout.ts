"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { requireAccess, type SessionUser } from "@/lib/auth/server";
import {
  eventCloseouts,
  eventCloseoutContributorMetrics,
  eventContributorLimits,
  externalDjLinks,
  guestActivityLedger,
  guestLimitRequests,
  guests,
  users,
} from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { requireActiveVenueId } from "@/lib/tenant/active-server";
import { reportServerError } from "@/lib/observability/structured-log";
import { eventIncludesLegacyDateRows, loadEventById } from "@/lib/events/server";
import {
  buildNightCloseout,
  closeoutHashPayload,
  type CloseoutContributorInput,
  type NightCloseoutReport,
} from "@/lib/closeout/domain";
import {
  buildCloseoutContributorSnapshot,
  getContributorSnapshotIntegrity,
  type ContributorSnapshotIntegrity,
} from "@/lib/closeout/contributor-snapshot";
import { persistEventCloseoutConfirmation } from "@/lib/closeout/persistence";
import type { ApiResponse, Event } from "@/lib/api/types";

type Db = ReturnType<typeof getDb>;

export interface EventCloseoutView {
  report: NightCloseoutReport;
  confirmationIntegrity: "unconfirmed" | "verified" | "drifted";
  contributorSnapshotIntegrity: ContributorSnapshotIntegrity;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function requireManagedEvent(
  db: Db,
  actor: SessionUser,
  eventId: string,
): Promise<Event> {
  const event = await loadEventById(db, eventId);
  if (!event) throw new Error("EVENT_NOT_FOUND");
  if (actor.role !== "super_admin" && event.venueId !== actor.venueId) {
    throw new Error("FORBIDDEN");
  }
  await requireActiveVenueId(event.venueId);
  return event;
}

async function buildEventCloseout(
  db: Db,
  actor: SessionUser,
  eventId: string,
): Promise<{ event: Event; view: EventCloseoutView; reportHash: string }> {
  const event = await requireManagedEvent(db, actor, eventId);
  const includeLegacy = eventIncludesLegacyDateRows(event);
  const guestScope = includeLegacy
    ? or(
        eq(guests.eventId, event.id),
        and(isNull(guests.eventId), eq(guests.date, event.businessDate)),
      )
    : eq(guests.eventId, event.id);
  const linkScope = includeLegacy
    ? or(
        eq(externalDjLinks.eventId, event.id),
        and(isNull(externalDjLinks.eventId), eq(externalDjLinks.date, event.businessDate)),
      )
    : eq(externalDjLinks.eventId, event.id);
  const requestScope = includeLegacy
    ? or(
        eq(guestLimitRequests.eventId, event.id),
        and(
          isNull(guestLimitRequests.eventId),
          eq(guestLimitRequests.date, event.businessDate),
        ),
      )
    : eq(guestLimitRequests.eventId, event.id);

  const [
    guestRows,
    activityRows,
    userRows,
    linkRows,
    configuredLimits,
    approvedExtras,
    confirmationRows,
    contributorMetricRows,
  ] = await Promise.all([
    db
      .select({
        id: guests.id,
        status: guests.status,
        createdByUserId: guests.createdByUserId,
        externalLinkId: guests.externalLinkId,
        createdAt: guests.createdAt,
      })
      .from(guests)
      .where(and(eq(guests.venueId, event.venueId), guestScope)),
    db
      .select({
        guestId: guestActivityLedger.guestId,
        action: guestActivityLedger.action,
        outcome: guestActivityLedger.outcome,
        nextStatus: guestActivityLedger.nextStatus,
        channel: guestActivityLedger.channel,
        occurredAt: guestActivityLedger.occurredAt,
        sequence: sql<number>`guest_activity_ledger.rowid`,
      })
      .from(guestActivityLedger)
      .where(
        and(
          eq(guestActivityLedger.venueId, event.venueId),
          eq(guestActivityLedger.eventId, event.id),
        ),
      ),
    db
      .select({
        id: users.id,
        contributorId: users.contributorId,
        name: users.name,
        guestLimit: users.guestLimit,
      })
      .from(users)
      .where(eq(users.venueId, event.venueId)),
    db
      .select({
        id: externalDjLinks.id,
        contributorId: externalDjLinks.contributorId,
        name: externalDjLinks.djName,
        maxGuests: externalDjLinks.maxGuests,
      })
      .from(externalDjLinks)
      .where(and(eq(externalDjLinks.venueId, event.venueId), linkScope)),
    db
      .select({
        userId: eventContributorLimits.userId,
        guestLimit: eventContributorLimits.guestLimit,
      })
      .from(eventContributorLimits)
      .where(
        and(
          eq(eventContributorLimits.eventId, event.id),
          eq(eventContributorLimits.venueId, event.venueId),
        ),
      ),
    db
      .select({
        userId: guestLimitRequests.userId,
        approvedExtra: sql<number>`coalesce(sum(${guestLimitRequests.approvedExtra}), 0)`,
      })
      .from(guestLimitRequests)
      .where(
        and(
          eq(guestLimitRequests.venueId, event.venueId),
          eq(guestLimitRequests.status, "approved"),
          requestScope,
        ),
      )
      .groupBy(guestLimitRequests.userId),
    db
      .select()
      .from(eventCloseouts)
      .where(
        and(
          eq(eventCloseouts.eventId, event.id),
          eq(eventCloseouts.venueId, event.venueId),
        ),
      )
      .limit(1),
    db
      .select({
        eventId: eventCloseoutContributorMetrics.eventId,
        venueId: eventCloseoutContributorMetrics.venueId,
        contributorId: eventCloseoutContributorMetrics.contributorId,
        sourceKind: eventCloseoutContributorMetrics.sourceKind,
        sourceId: eventCloseoutContributorMetrics.sourceId,
        registeredCount: eventCloseoutContributorMetrics.registeredCount,
        checkedInCount: eventCloseoutContributorMetrics.checkedInCount,
        createdAt: eventCloseoutContributorMetrics.createdAt,
      })
      .from(eventCloseoutContributorMetrics)
      .where(
        and(
          eq(eventCloseoutContributorMetrics.eventId, event.id),
          eq(eventCloseoutContributorMetrics.venueId, event.venueId),
        ),
      ),
  ]);

  const configuredLimitMap = new Map(
    configuredLimits.map((limit) => [limit.userId, limit.guestLimit]),
  );
  const approvedExtraMap = new Map(
    approvedExtras.map((extra) => [extra.userId, Number(extra.approvedExtra)]),
  );
  const contributors: CloseoutContributorInput[] = [
    ...userRows.map((user) => ({
      kind: "user" as const,
      id: user.id,
      contributorId: user.contributorId,
      label: user.name,
      baseLimit: configuredLimitMap.has(user.id)
        ? configuredLimitMap.get(user.id) ?? null
        : user.guestLimit,
      approvedExtra: approvedExtraMap.get(user.id) ?? 0,
    })),
    ...linkRows.map((link) => ({
      kind: "external_link" as const,
      id: link.id,
      contributorId: link.contributorId,
      label: link.name,
      baseLimit: link.maxGuests,
      approvedExtra: 0,
    })),
  ];
  const confirmation = confirmationRows[0] ?? null;
  const report = buildNightCloseout({
    event: {
      id: event.id,
      state: event.state,
      doorOpensAt: event.doorOpensAt,
      createdAt: event.createdAt,
      openedAt: event.openedAt,
      closedAt: event.closedAt,
    },
    guests: guestRows.map((guest) => ({
      ...guest,
      status: guest.status as "pending" | "checked" | "deleted",
    })),
    activities: activityRows,
    contributors,
    confirmedAt: confirmation?.confirmedAt ?? null,
  });
  const reportHash = await sha256(closeoutHashPayload(report));
  const confirmationIntegrity: EventCloseoutView["confirmationIntegrity"] = !confirmation
    ? "unconfirmed"
    : confirmation.reportHash === reportHash &&
        confirmation.registeredCount === report.registered &&
        confirmation.checkedInCount === report.checkedIn &&
        confirmation.sourceActivityCount === report.ledger.sourceActivityCount
      ? "verified"
      : "drifted";
  if (confirmationIntegrity === "drifted") report.status = "inconsistent";
  const expectedContributorMetrics = buildCloseoutContributorSnapshot({
    eventId: event.id,
    venueId: event.venueId,
    createdAt: confirmation?.confirmedAt ?? "",
    report,
  });
  const contributorSnapshotIntegrity = getContributorSnapshotIntegrity({
    isConfirmed: confirmation !== null,
    expected: expectedContributorMetrics,
    persisted: contributorMetricRows.map((metric) => ({
      ...metric,
      sourceKind: metric.sourceKind as "user" | "external_link" | "unattributed",
    })),
  });
  return {
    event,
    view: { report, confirmationIntegrity, contributorSnapshotIntegrity },
    reportHash,
  };
}

export async function fetchEventCloseout(
  eventId: string,
): Promise<ApiResponse<EventCloseoutView>> {
  try {
    const actor = await requireAccess("admin");
    const result = await buildEventCloseout(getDb(), actor, eventId);
    return { data: result.view, error: null };
  } catch (error: unknown) {
    await reportServerError("event.closeout.load", error);
    return { data: null, error: "EVENT_CLOSEOUT_LOAD_FAILED" };
  }
}

export async function confirmEventCloseout(
  eventId: string,
): Promise<ApiResponse<EventCloseoutView>> {
  try {
    const actor = await requireAccess("admin");
    const db = getDb();
    const current = await buildEventCloseout(db, actor, eventId);
    if (current.event.state !== "closed" && current.event.state !== "archived") {
      return { data: null, error: "EVENT_NOT_CLOSED" };
    }
    if (
      current.view.report.ledger.invariantMismatchCount > 0 ||
      current.view.report.ledger.untrackedGuestCount > 0 ||
      current.view.confirmationIntegrity === "drifted"
    ) {
      return { data: null, error: "EVENT_CLOSEOUT_INCONSISTENT" };
    }
    const confirmedAt = new Date().toISOString();
    const { env } = getCloudflareContext();
    const contributorMetrics = buildCloseoutContributorSnapshot({
      eventId: current.event.id,
      venueId: current.event.venueId,
      createdAt: confirmedAt,
      report: current.view.report,
    });
    await persistEventCloseoutConfirmation({
      database: env.DB,
      eventId: current.event.id,
      venueId: current.event.venueId,
      confirmedByUserId: actor.id,
      confirmedAt,
      reportHash: current.reportHash,
      registeredCount: current.view.report.registered,
      checkedInCount: current.view.report.checkedIn,
      sourceActivityCount: current.view.report.ledger.sourceActivityCount,
      contributorMetrics,
    });
    const confirmed = await buildEventCloseout(db, actor, eventId);
    if (
      confirmed.view.confirmationIntegrity !== "verified" ||
      confirmed.view.contributorSnapshotIntegrity !== "verified"
    ) {
      throw new Error("EVENT_CLOSEOUT_CONFIRMATION_FAILED");
    }
    return { data: confirmed.view, error: null };
  } catch (error: unknown) {
    await reportServerError("event.closeout.confirm", error);
    return { data: null, error: "EVENT_CLOSEOUT_CONFIRM_FAILED" };
  }
}

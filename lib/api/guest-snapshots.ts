"use server";

import { measureServerOperation } from "@/lib/observability/server-performance";

import { reportServerError } from "@/lib/observability/structured-log";

import { and, asc, desc, eq, isNull, ne, or } from "drizzle-orm";
import { externalDjLinks, users } from "../db/schema";
import { getDb } from "../db/client";
import { requireAccess, type SessionUser } from "../auth/server";
import { requireActiveVenueId } from "../tenant/active-server";
import { canRequestGuestLimit, isAccountKind, isRole } from "@/lib/users/policy";
import { resolveSnapshotVenueId } from "@/lib/guest-snapshot-policy";
import { loadSnapshotGuests } from "@/lib/guest-snapshots/persistence";
import { loadGuestQuotaState } from "@/lib/guest-limits/quota-persistence";
import type { ApiResponse } from "./response";
import type { Event } from "@/lib/events/types";
import type { ExternalLinkDirectoryEntry } from "@/lib/external-links/types";
import type { GuestQuota } from "@/lib/guest-limits/types";
import type {
  GuestOperationsSnapshot,
  GuestWorkspaceSnapshot,
} from "@/lib/guest-snapshots/types";
import type { Guest } from "@/lib/guests/types";
import type { UserDirectoryEntry } from "@/lib/users/types";
import {
  eventIncludesLegacyDateRows,
  findCompatibilityEvent,
  loadEventById,
} from "@/lib/events/server";

type Db = ReturnType<typeof getDb>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function logRejectedSection(section: string, result: PromiseRejectedResult): Promise<void> {
  await reportServerError(`guest_snapshot.${section.replaceAll(" ", "_")}`, result.reason);
}

async function loadGuestsByDate(
  db: Db,
  venueId: string,
  date: string,
  createdByUserId?: string,
  event?: Event | null,
): Promise<Guest[]> {
  return loadSnapshotGuests(db, {
    venueId,
    date,
    eventId: event?.id ?? null,
    includeLegacyDateRows: event ? eventIncludesLegacyDateRows(event) : false,
    createdByUserId,
  });
}

async function loadUserDirectory(
  db: Db,
  actor: SessionUser,
  venueId: string,
): Promise<UserDirectoryEntry[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      accountKind: users.accountKind,
      doorAccessEnabled: users.doorAccessEnabled,
    })
    .from(users)
    .where(
      actor.role === "super_admin"
        ? eq(users.venueId, venueId)
        : and(eq(users.venueId, venueId), ne(users.role, "super_admin")),
    )
    .orderBy(asc(users.name));

  return rows.map((user) => {
    if (!isRole(user.role) || !isAccountKind(user.accountKind)) {
      throw new Error("Invalid user directory entry");
    }
    return {
      ...user,
      role: user.role,
      accountKind: user.accountKind,
    };
  });
}

async function loadExternalLinksByDate(
  db: Db,
  venueId: string,
  date: string,
  event?: Event | null,
): Promise<ExternalLinkDirectoryEntry[]> {
  const eventScope = event
    ? eventIncludesLegacyDateRows(event)
      ? or(
          eq(externalDjLinks.eventId, event.id),
          and(isNull(externalDjLinks.eventId), eq(externalDjLinks.date, date)),
        )
      : eq(externalDjLinks.eventId, event.id)
    : and(isNull(externalDjLinks.eventId), eq(externalDjLinks.date, date));
  return db
    .select({
      id: externalDjLinks.id,
      djName: externalDjLinks.djName,
    })
    .from(externalDjLinks)
    .where(
      and(
        eq(externalDjLinks.venueId, venueId),
        eventScope,
      ),
    )
    .orderBy(desc(externalDjLinks.createdAt));
}

async function loadGuestQuota(
  db: Db,
  actor: SessionUser,
  venueId: string,
  date: string,
  event?: Event | null,
): Promise<GuestQuota> {
  const quota = await loadGuestQuotaState(db, {
    venueId,
    userId: actor.id,
    date,
    eventId: event?.id ?? null,
    includeLegacyRows: event ? eventIncludesLegacyDateRows(event) : true,
  });
  const baseLimit = quota.configuredLimit !== undefined
    ? quota.configuredLimit
    : actor.guestLimit;
  const effectiveLimit = baseLimit === null ? null : baseLimit + quota.approvedExtra;

  return {
    date,
    baseLimit,
    approvedExtra: quota.approvedExtra,
    effectiveLimit,
    used: quota.used,
    remaining: effectiveLimit === null ? null : Math.max(0, effectiveLimit - quota.used),
    canRequestExtra: canRequestGuestLimit(actor) && baseLimit !== null,
    pendingRequest: quota.pendingRequest
      ? { ...quota.pendingRequest, status: "pending" }
      : null,
  };
}

export async function fetchGuestOperationsSnapshot(
  date: string,
  venueId: string,
  eventId?: string | null,
): Promise<ApiResponse<GuestOperationsSnapshot>> {
  return measureServerOperation("server.door_snapshot", async (): Promise<ApiResponse<GuestOperationsSnapshot>> => {
    try {
      if (!isValidDate(date)) throw new Error("Invalid date");
      const actor = await requireAccess("door");
      const effectiveVenueId = resolveSnapshotVenueId(actor, venueId);
      await requireActiveVenueId(effectiveVenueId);
      const db = getDb();
      const event = eventId
        ? await loadEventById(db, eventId)
        : await findCompatibilityEvent(effectiveVenueId, date);
      if (
        eventId &&
        (!event ||
          event.venueId !== effectiveVenueId ||
          event.businessDate !== date)
      ) {
        throw new Error("EVENT_NOT_FOUND");
      }

      const [guestResult, userResult, linkResult] = await Promise.allSettled([
        loadGuestsByDate(db, effectiveVenueId, date, undefined, event),
        loadUserDirectory(db, actor, effectiveVenueId),
        loadExternalLinksByDate(db, effectiveVenueId, date, event),
      ]);

      if (guestResult.status === "rejected") await logRejectedSection("guests", guestResult);
      if (userResult.status === "rejected") await logRejectedSection("users", userResult);
      if (linkResult.status === "rejected") await logRejectedSection("external links", linkResult);
      const failedSections: GuestOperationsSnapshot["failedSections"] = [];
      if (guestResult.status === "rejected") failedSections.push("guests");
      if (userResult.status === "rejected") failedSections.push("users");
      if (linkResult.status === "rejected") failedSections.push("externalLinks");

      return {
        data: {
          guests: guestResult.status === "fulfilled" ? guestResult.value : [],
          users: userResult.status === "fulfilled" ? userResult.value : [],
          externalLinks: linkResult.status === "fulfilled" ? linkResult.value : [],
          failedSections,
          offlineRosterStatus: eventId && event?.compatibilityKey === null && event.state === "open"
            ? "available" : "unavailable",
        },
        error: failedSections.length > 0
          ? "Unable to load some guest operations data right now."
          : null,
      };
    } catch (error: unknown) {
      await reportServerError("guest_snapshot.operations", error);
      return {
        data: null,
        error: "Unable to load guest operations data right now.",
      };
    }
  });
}

export async function fetchGuestWorkspaceSnapshot(
  date: string,
  venueId: string,
  eventId?: string | null,
): Promise<ApiResponse<GuestWorkspaceSnapshot>> {
  return measureServerOperation("server.guest_snapshot", async (): Promise<ApiResponse<GuestWorkspaceSnapshot>> => {
    try {
      if (!isValidDate(date)) throw new Error("Invalid date");
      const actor = await requireAccess("guest");
      const effectiveVenueId = resolveSnapshotVenueId(actor, venueId);
      await requireActiveVenueId(effectiveVenueId);
      const db = getDb();
      const event = eventId
        ? await loadEventById(db, eventId)
        : await findCompatibilityEvent(effectiveVenueId, date);
      if (
        eventId &&
        (!event ||
          event.venueId !== effectiveVenueId ||
          event.businessDate !== date)
      ) {
        throw new Error("EVENT_NOT_FOUND");
      }

      const [guestResult, quotaResult] = await Promise.allSettled([
        loadGuestsByDate(db, effectiveVenueId, date, actor.id, event),
        loadGuestQuota(db, actor, effectiveVenueId, date, event),
      ]);

      if (guestResult.status === "rejected") await logRejectedSection("guests", guestResult);
      if (quotaResult.status === "rejected") await logRejectedSection("guest quota", quotaResult);
      const failedSections: GuestWorkspaceSnapshot["failedSections"] = [];
      if (guestResult.status === "rejected") failedSections.push("guests");
      if (quotaResult.status === "rejected") failedSections.push("quota");

      return {
        data: {
          guests: guestResult.status === "fulfilled" ? guestResult.value : [],
          quota: quotaResult.status === "fulfilled" ? quotaResult.value : null,
          failedSections,
        },
        error: failedSections.length > 0
          ? "Unable to load some guest workspace data right now."
          : null,
      };
    } catch (error: unknown) {
      await reportServerError("guest_snapshot.workspace", error);
      return {
        data: null,
        error: "Unable to load guest workspace data right now.",
      };
    }
  });
}

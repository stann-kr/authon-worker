"use server";

import { reportServerError } from "@/lib/observability/structured-log";

import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { externalDjLinks, guestLimitRequests, guests, users } from "../db/schema";
import { getDb } from "../db/client";
import { requireAccess, type SessionUser } from "../auth/server";
import { requireActiveVenueId } from "../tenant/active-server";
import { canRequestGuestLimit, isAccountKind, isRole } from "@/lib/users/policy";
import { resolveSnapshotVenueId } from "@/lib/guest-snapshot-policy";
import type {
  ApiResponse,
  ExternalLinkDirectoryEntry,
  Guest,
  GuestOperationsSnapshot,
  GuestQuota,
  GuestWorkspaceSnapshot,
  UserDirectoryEntry,
} from "./types";

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
): Promise<Guest[]> {
  const conditions = [
    eq(guests.venueId, venueId),
    eq(guests.date, date),
    ne(guests.status, "deleted"),
  ];
  if (createdByUserId) {
    conditions.push(eq(guests.createdByUserId, createdByUserId));
  }

  const rows = await db
    .select()
    .from(guests)
    .where(and(...conditions))
    .orderBy(desc(guests.createdAt));

  return rows.map((guest) => ({
    ...guest,
    status: guest.status as Guest["status"],
  }));
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
): Promise<ExternalLinkDirectoryEntry[]> {
  return db
    .select({
      id: externalDjLinks.id,
      djName: externalDjLinks.djName,
    })
    .from(externalDjLinks)
    .where(
      and(
        eq(externalDjLinks.venueId, venueId),
        eq(externalDjLinks.date, date),
      ),
    )
    .orderBy(desc(externalDjLinks.createdAt));
}

async function loadGuestQuota(
  db: Db,
  actor: SessionUser,
  date: string,
): Promise<GuestQuota> {
  const [usage, extra, pending] = await Promise.all([
    db
      .select({ used: sql<number>`count(*)` })
      .from(guests)
      .where(
        and(
          eq(guests.createdByUserId, actor.id),
          eq(guests.date, date),
          ne(guests.status, "deleted"),
        ),
      ),
    db
      .select({
        approvedExtra: sql<number>`coalesce(sum(${guestLimitRequests.approvedExtra}), 0)`,
      })
      .from(guestLimitRequests)
      .where(
        and(
          eq(guestLimitRequests.userId, actor.id),
          eq(guestLimitRequests.date, date),
          eq(guestLimitRequests.status, "approved"),
        ),
      ),
    db
      .select()
      .from(guestLimitRequests)
      .where(
        and(
          eq(guestLimitRequests.userId, actor.id),
          eq(guestLimitRequests.date, date),
          eq(guestLimitRequests.status, "pending"),
        ),
      )
      .limit(1),
  ]);

  const used = Number(usage[0]?.used ?? 0);
  const approvedExtra = Number(extra[0]?.approvedExtra ?? 0);
  const effectiveLimit =
    actor.guestLimit === null ? null : actor.guestLimit + approvedExtra;

  return {
    date,
    baseLimit: actor.guestLimit,
    approvedExtra,
    effectiveLimit,
    used,
    remaining:
      effectiveLimit === null ? null : Math.max(0, effectiveLimit - used),
    canRequestExtra:
      canRequestGuestLimit(actor) && actor.guestLimit !== null,
    pendingRequest: pending[0]
      ? { ...pending[0], status: "pending" }
      : null,
  };
}

export async function fetchGuestOperationsSnapshot(
  date: string,
  venueId: string,
): Promise<ApiResponse<GuestOperationsSnapshot>> {
  try {
    if (!isValidDate(date)) throw new Error("Invalid date");
    const actor = await requireAccess("door");
    const effectiveVenueId = resolveSnapshotVenueId(actor, venueId);
    await requireActiveVenueId(effectiveVenueId);
    const db = getDb();

    const [guestResult, userResult, linkResult] = await Promise.allSettled([
      loadGuestsByDate(db, effectiveVenueId, date),
      loadUserDirectory(db, actor, effectiveVenueId),
      loadExternalLinksByDate(db, effectiveVenueId, date),
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
}

export async function fetchGuestWorkspaceSnapshot(
  date: string,
  venueId: string,
): Promise<ApiResponse<GuestWorkspaceSnapshot>> {
  try {
    if (!isValidDate(date)) throw new Error("Invalid date");
    const actor = await requireAccess("guest");
    const effectiveVenueId = resolveSnapshotVenueId(actor, venueId);
    await requireActiveVenueId(effectiveVenueId);
    const db = getDb();

    const [guestResult, quotaResult] = await Promise.allSettled([
      loadGuestsByDate(db, effectiveVenueId, date, actor.id),
      loadGuestQuota(db, actor, date),
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
}

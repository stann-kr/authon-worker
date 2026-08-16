"use server";

import { reportServerError } from "@/lib/observability/structured-log";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import {
  eq,
  and,
  ne,
  desc,
  asc,
  inArray,
  isNull,
  isNotNull,
  or,
  sql,
} from "drizzle-orm";
import {
  contributorAuditEvents,
  externalDjLinks,
  externalGuestOwners,
  venues,
  guests,
  venueContributors,
} from "../db/schema";
import {
  type ApiResponse,
  type BulkGuestCreateInput,
  type BulkGuestCreateItemResult,
  type BulkGuestCreateResult,
  type ExternalDJLink,
  type ExternalDjSuggestion,
  type Guest,
  type Venue,
} from "./types";
import { requireRole, type SessionUser } from "../auth/server";
import {
  consumeRateLimit,
  getRequestIpFromHeaders,
} from "../auth/rate-limit";
import { getDb } from "../db/client";
import { getRequestTenantContext, getVenueDeliveryContext } from "../tenant/server";
import { requireActiveVenueId } from "../tenant/active-server";
import {
  MAX_BULK_WRITE_NAMES,
  prepareGuestName,
  toStoredGuestName,
} from "@/lib/guests/bulk-entry";
import {
  buildExternalGuestReservationSql,
  DECREMENT_SELF_RSVP_FOR_PENDING_GUEST_SQL,
  DECREMENT_EXTERNAL_LINK_FOR_PENDING_GUEST_SQL,
  EXTERNAL_GUEST_INSERT_AFTER_RESERVATION_SQL,
  INSERT_SELF_RSVP_OWNER_AFTER_GUEST_SQL,
  RESERVE_SELF_RSVP_SLOT_SQL,
  SOFT_DELETE_EXTERNAL_GUEST_AFTER_DECREMENT_SQL,
  UPDATE_SELF_RSVP_GUEST_SQL,
} from "@/lib/guests/atomic-sql";
import {
  getExternalLinkDeletionDisposition,
  isValidExternalLinkDate,
  prepareExternalLinkCreateInput,
  toExternalDJLink,
} from "../external-links/domain";
import {
  eventIncludesLegacyDateRows,
  findCompatibilityEvent,
  loadEventById,
  resolveEventForRosterWrite,
} from "@/lib/events/server";
import { prepareGuestActivityAfterChange } from "@/lib/guests/activity-ledger";
import { hashOpaqueIdentifier } from "@/lib/guests/activity-ledger";
import { isValidExternalOwnerKey } from "@/lib/external-links/ownership";
import { getContributorNameKey } from "@/lib/contributors/domain";
import {
  getExternalDjContributorId,
  getExternalDjCreatedAuditId,
} from "@/lib/contributors/external-dj";

type Db = ReturnType<typeof getDb>;

const DEFAULT_EXTERNAL_LINK_TTL_DAYS = 7;
const EXTERNAL_GUEST_RATE_LIMIT_NAMES = 100;
const EXTERNAL_GUEST_RATE_LIMIT_WINDOW_SECONDS = 60;
const INVALID_EXTERNAL_LINK_ERROR = "INVALID_EXTERNAL_LINK";
const EXTERNAL_LINK_UNAVAILABLE_ERROR = "EXTERNAL_LINK_UNAVAILABLE";
const MAX_EXTERNAL_DJ_DIRECTORY_ROWS = 500;

class ExternalDjContributorError extends Error {
  constructor(readonly code: "INVALID_CONTRIBUTOR" | "DJ_DIRECTORY_TOO_LARGE") {
    super(code);
  }
}

function parseBulkGuestCreateInput(value: unknown): {
  name: string;
  allowDuplicate: boolean;
} | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { name?: unknown; allowDuplicate?: unknown };
  if (typeof candidate.name !== "string") return null;
  if (
    candidate.allowDuplicate !== undefined &&
    typeof candidate.allowDuplicate !== "boolean"
  ) {
    return null;
  }
  return {
    name: candidate.name,
    allowDuplicate: candidate.allowDuplicate === true,
  };
}

function defaultExternalLinkExpiresAt(date?: string | null): string {
  if (date) {
    const eventDay = new Date(`${date}T23:59:59.999Z`);
    if (!Number.isNaN(eventDay.getTime())) {
      eventDay.setUTCDate(eventDay.getUTCDate() + 1);
      return eventDay.toISOString();
    }
  }

  return new Date(Date.now() + DEFAULT_EXTERNAL_LINK_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

async function scopedVenueId(user: SessionUser, requestedVenueId: string): Promise<string> {
  if (!requestedVenueId) throw new Error("Venue is required");
  const venueId = user.role === "super_admin" ? requestedVenueId : user.venueId;
  if (!venueId || requestedVenueId !== venueId) throw new Error("Forbidden");
  return requireActiveVenueId(venueId);
}

async function getAccessibleLink(db: Db, user: SessionUser, linkId: string) {
  const rows = await db
    .select()
    .from(externalDjLinks)
    .where(
      and(
        eq(externalDjLinks.id, linkId),
        isNull(externalDjLinks.deletedAt),
      ),
    )
    .limit(1);
  const link = rows[0];
  if (!link) throw new Error("External link not found");
  if (user.role !== "super_admin" && link.venueId !== user.venueId) throw new Error("Forbidden");
  await requireActiveVenueId(link.venueId);
  return link;
}

function isExpired(expiresAt?: string | null): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() <= Date.now();
}

async function addGuestUrls(
  venueId: string,
  links: Array<typeof externalDjLinks.$inferSelect>,
): Promise<ExternalDJLink[]> {
  const { baseUrl } = await getVenueDeliveryContext(venueId);
  return links.map((link) =>
    toExternalDJLink(
      link,
      `${baseUrl}/guest?token=${encodeURIComponent(link.token)}${
      link.localeMode === "en" || link.localeMode === "ko" ? `&lang=${link.localeMode}` : ""
      }`,
    ),
  );
}

export async function fetchExternalLinks(venueId: string): Promise<ApiResponse<ExternalDJLink[]>> {
  try {
    const user = await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    const effectiveVenueId = await scopedVenueId(user, venueId);
    const result = await db.select().from(externalDjLinks)
      .where(
        and(
          eq(externalDjLinks.venueId, effectiveVenueId),
          isNull(externalDjLinks.deletedAt),
        ),
      )
      .orderBy(desc(externalDjLinks.createdAt), desc(externalDjLinks.date));
    return { data: await addGuestUrls(effectiveVenueId, result), error: null };
  } catch (error: unknown) {
    await reportServerError("external_link.list", error);
    return { data: null, error: "Unable to load external links right now." };
  }
}

export async function fetchExternalLinksByDate(
  venueId: string,
  date: string,
  eventId?: string | null,
): Promise<ApiResponse<ExternalDJLink[]>> {
  try {
    const user = await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    const effectiveVenueId = await scopedVenueId(user, venueId);
    const conditions = [
      eq(externalDjLinks.venueId, effectiveVenueId),
      eq(externalDjLinks.date, date),
      isNull(externalDjLinks.deletedAt),
    ];
    if (eventId) {
      const event = await loadEventById(db, eventId);
      if (
        !event ||
        event.venueId !== effectiveVenueId ||
        event.businessDate !== date
      ) {
        throw new Error("EVENT_NOT_FOUND");
      }
      conditions.push(eq(externalDjLinks.eventId, event.id));
    } else {
      const compatibilityEvent = await findCompatibilityEvent(
        effectiveVenueId,
        date,
      );
      conditions.push(
        compatibilityEvent && eventIncludesLegacyDateRows(compatibilityEvent)
          ? or(
              eq(externalDjLinks.eventId, compatibilityEvent.id),
              isNull(externalDjLinks.eventId),
            )!
          : isNull(externalDjLinks.eventId),
      );
    }
    const result = await db.select().from(externalDjLinks)
      .where(
        and(...conditions),
      )
      .orderBy(desc(externalDjLinks.createdAt));
    return { data: await addGuestUrls(effectiveVenueId, result), error: null };
  } catch (error: unknown) {
    await reportServerError("external_link.list_by_date", error);
    return { data: null, error: "Unable to load external links right now." };
  }
}

export async function fetchRecentExternalLinks(
  venueId: string,
  limit: 5 | 10,
  eventId?: string | null,
): Promise<ApiResponse<ExternalDJLink[]>> {
  try {
    const user = await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    const effectiveVenueId = await scopedVenueId(user, venueId);
    const normalizedLimit = limit === 10 ? 10 : 5;
    const conditions = [
      eq(externalDjLinks.venueId, effectiveVenueId),
      isNull(externalDjLinks.deletedAt),
    ];
    if (eventId) {
      const event = await loadEventById(db, eventId);
      if (!event || event.venueId !== effectiveVenueId) {
        throw new Error("EVENT_NOT_FOUND");
      }
      conditions.push(eq(externalDjLinks.eventId, event.id));
    }
    const result = await db
      .select()
      .from(externalDjLinks)
      .where(and(...conditions))
      .orderBy(desc(externalDjLinks.createdAt), desc(externalDjLinks.date))
      .limit(normalizedLimit);
    return { data: await addGuestUrls(effectiveVenueId, result), error: null };
  } catch (error: unknown) {
    await reportServerError("external_link.list_recent", error);
    return { data: null, error: "Unable to load recent external links right now." };
  }
}

export async function fetchExternalDjDirectory(
  venueId: string,
): Promise<ApiResponse<ExternalDjSuggestion[]>> {
  try {
    const user = await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    const effectiveVenueId = await scopedVenueId(user, venueId);
    const rows = await db
      .select({
        contributorId: venueContributors.id,
        displayName: venueContributors.displayName,
        linkCount: sql<number>`count(${externalDjLinks.id})`.mapWith(Number),
        lastUsedDate: sql<string | null>`max(${externalDjLinks.date})`,
      })
      .from(venueContributors)
      .leftJoin(
        externalDjLinks,
        and(
          eq(externalDjLinks.contributorId, venueContributors.id),
          eq(externalDjLinks.kind, "contributor"),
        ),
      )
      .where(
        and(
          eq(venueContributors.venueId, effectiveVenueId),
          eq(venueContributors.active, true),
          isNotNull(venueContributors.nameKey),
        ),
      )
      .groupBy(venueContributors.id, venueContributors.displayName)
      .orderBy(desc(sql`max(${externalDjLinks.date})`), asc(venueContributors.displayName))
      .limit(MAX_EXTERNAL_DJ_DIRECTORY_ROWS + 1);
    if (rows.length > MAX_EXTERNAL_DJ_DIRECTORY_ROWS) {
      throw new ExternalDjContributorError("DJ_DIRECTORY_TOO_LARGE");
    }
    return { data: rows, error: null };
  } catch (error: unknown) {
    await reportServerError("external_dj.directory", error);
    return {
      data: null,
      error:
        error instanceof ExternalDjContributorError
          ? error.code
          : "DJ_DIRECTORY_UNAVAILABLE",
    };
  }
}

async function resolveExternalDjContributor(params: {
  db: Db;
  venueId: string;
  displayName: string;
  requestedContributorId: string | null;
}) {
  const nameKey = getContributorNameKey(params.displayName);
  if (!nameKey) throw new ExternalDjContributorError("INVALID_CONTRIBUTOR");

  const conditions = [
    eq(venueContributors.venueId, params.venueId),
    params.requestedContributorId
      ? eq(venueContributors.id, params.requestedContributorId)
      : eq(venueContributors.nameKey, nameKey),
  ];
  const [existing] = await params.db
    .select()
    .from(venueContributors)
    .where(and(...conditions))
    .limit(1);
  if (existing) {
    if (!existing.active || existing.nameKey !== nameKey) {
      throw new ExternalDjContributorError("INVALID_CONTRIBUTOR");
    }
    return {
      id: existing.id,
      displayName: existing.displayName,
      nameKey,
      shouldCreate: false,
    };
  }
  if (params.requestedContributorId) {
    throw new ExternalDjContributorError("INVALID_CONTRIBUTOR");
  }
  return {
    id: await getExternalDjContributorId(params.venueId, nameKey),
    displayName: params.displayName,
    nameKey,
    shouldCreate: true,
  };
}

export async function createExternalLink(link: {
  venueId: string;
  djName: string;
  contributorId?: string | null;
  event: string;
  date: string;
  maxGuests: number;
  eventId?: string | null;
  localeMode?: ExternalDJLink["localeMode"];
  kind?: ExternalDJLink["kind"];
}): Promise<ApiResponse<ExternalDJLink>> {
  try {
    const user = await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    const effectiveVenueId = await scopedVenueId(user, link.venueId);
    const prepared = prepareExternalLinkCreateInput(link);
    if (prepared.error || !prepared.draft) {
      return { data: null, error: prepared.error ?? "INVALID_EXTERNAL_LINK_INPUT" };
    }
    const draft = prepared.draft;
    const event = await resolveEventForRosterWrite({
      venueId: effectiveVenueId,
      businessDate: draft.date,
      eventId: link.eventId,
      actorUserId: user.id,
      purpose: "register",
    });
    const expiresAt = defaultExternalLinkExpiresAt(draft.date);
    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const contributor =
      draft.kind === "contributor"
        ? await resolveExternalDjContributor({
            db,
            venueId: effectiveVenueId,
            displayName: draft.djName,
            requestedContributorId: draft.contributorId,
          })
        : null;
    const linkInsert = db.insert(externalDjLinks).values({
      id,
      venueId: effectiveVenueId,
      token,
      djName: contributor?.displayName ?? draft.djName,
      contributorId: contributor?.id ?? null,
      event: draft.event,
      date: draft.date,
      eventId: event.id,
      maxGuests: draft.maxGuests,
      localeMode: draft.localeMode,
      kind: draft.kind,
      usedGuests: 0,
      active: true,
      expiresAt,
      createdBy: user.id,
      createdAt,
    });
    if (contributor) {
      const mappingAudit = db.insert(contributorAuditEvents).values({
        id: crypto.randomUUID(),
        venueId: effectiveVenueId,
        contributorId: contributor.id,
        actorUserId: user.id,
        sourceKind: "external_link",
        sourceId: id,
        action: "mapped",
        details: JSON.stringify({ reason: "external_link_create" }),
        createdAt,
      });
      if (contributor.shouldCreate) {
        await db.batch([
          db
            .insert(venueContributors)
            .values({
              id: contributor.id,
              venueId: effectiveVenueId,
              displayName: contributor.displayName,
              nameKey: contributor.nameKey,
              kind: "dj",
              active: true,
              createdAt,
              updatedAt: createdAt,
            })
            .onConflictDoNothing(),
          db
            .insert(contributorAuditEvents)
            .values({
              id: getExternalDjCreatedAuditId(contributor.id),
              venueId: effectiveVenueId,
              contributorId: contributor.id,
              actorUserId: user.id,
              sourceKind: "contributor",
              sourceId: contributor.id,
              action: "created",
              details: JSON.stringify({ kind: "dj", source: "external_link_create" }),
              createdAt,
            })
            .onConflictDoNothing(),
          linkInsert,
          mappingAudit,
        ]);
      } else {
        await db.batch([linkInsert, mappingAudit]);
      }
    } else {
      await linkInsert;
    }
    const result = await db.select().from(externalDjLinks).where(eq(externalDjLinks.id, id));
    const withGuestUrl = result[0]
      ? (await addGuestUrls(effectiveVenueId, [result[0]]))[0]
      : null;
    return { data: withGuestUrl, error: null };
  } catch (error: unknown) {
    await reportServerError("external_link.create", error);
    return {
      data: null,
      error:
        error instanceof ExternalDjContributorError
          ? error.code
          : "Unable to create external link right now.",
    };
  }
}

export async function deleteExternalLink(linkId: string): Promise<{ error: string | null }> {
  try {
    const user = await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    await getAccessibleLink(db, user, linkId);

    await db
      .update(externalDjLinks)
      .set({ active: false })
      .where(
        and(
          eq(externalDjLinks.id, linkId),
          isNull(externalDjLinks.deletedAt),
        ),
      );

    const [guestReference] = await db
      .select({ id: guests.id })
      .from(guests)
      .where(eq(guests.externalLinkId, linkId))
      .limit(1);
    const disposition = getExternalLinkDeletionDisposition(Boolean(guestReference));

    if (disposition === "archive") {
      await db
        .update(externalDjLinks)
        .set({
          active: false,
          deletedAt: new Date().toISOString(),
          deletedBy: user.id,
        })
        .where(
          and(
            eq(externalDjLinks.id, linkId),
            isNull(externalDjLinks.deletedAt),
          ),
        );
    } else {
      await db
        .delete(externalDjLinks)
        .where(
          and(
            eq(externalDjLinks.id, linkId),
            isNull(externalDjLinks.deletedAt),
          ),
        );
    }

    return { error: null };
  } catch (error: unknown) {
    await reportServerError("external_link.delete", error);
    return { error: "Unable to delete external link right now." };
  }
}

export async function deactivateExternalLink(linkId: string): Promise<{ error: string | null }> {
  try {
    const user = await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    await getAccessibleLink(db, user, linkId);
    await db.update(externalDjLinks).set({ active: false }).where(eq(externalDjLinks.id, linkId));
    return { error: null };
  } catch (error: unknown) {
    await reportServerError("external_link.deactivate", error);
    return { error: "Unable to update external link right now." };
  }
}

export async function activateExternalLink(linkId: string): Promise<{ error: string | null }> {
  try {
    const user = await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    const link = await getAccessibleLink(db, user, linkId);
    if (
      isExpired(link.expiresAt) ||
      !link.date ||
      !isValidExternalLinkDate(link.date)
    ) {
      throw new Error("Link cannot be activated");
    }
    await db.update(externalDjLinks).set({ active: true }).where(eq(externalDjLinks.id, linkId));
    return { error: null };
  } catch (error: unknown) {
    await reportServerError("external_link.activate", error);
    return { error: "Unable to update external link right now." };
  }
}

/** 외부 링크 검증 (인증 불필요 — 토큰 및 Self-RSVP 소유키 기반 공개 접근). */
export async function validateExternalToken(
  token: string,
  ownerKey?: string | null,
): Promise<ApiResponse<{ link: ExternalDJLink; venue: Venue; guests: Guest[] }>> {
  try {
    const db = getDb();
    const linkResult = await db.select().from(externalDjLinks).where(eq(externalDjLinks.token, token));
    const link = linkResult[0];

    if (
      !link ||
      link.deletedAt ||
      !link.active ||
      isExpired(link.expiresAt) ||
      !link.date ||
      !isValidExternalLinkDate(link.date)
    ) {
      return { data: null, error: INVALID_EXTERNAL_LINK_ERROR };
    }

    const tenant = await getRequestTenantContext();
    if (!tenant.resolved || (tenant.scope === "venue" && tenant.venueId !== link.venueId)) {
      return { data: null, error: INVALID_EXTERNAL_LINK_ERROR };
    }

    const venueResult = await db.select().from(venues).where(eq(venues.id, link.venueId));
    const venue = venueResult[0] as Venue;

    if (!venue?.active) {
      return { data: null, error: INVALID_EXTERNAL_LINK_ERROR };
    }

    let guestsResult: Array<typeof guests.$inferSelect> = [];
    if (link.kind === "self_rsvp") {
      if (isValidExternalOwnerKey(ownerKey)) {
        const ownerKeyHash = await hashOpaqueIdentifier(ownerKey);
        const ownedRows = await db
          .select({ guest: guests })
          .from(guests)
          .innerJoin(
            externalGuestOwners,
            eq(externalGuestOwners.guestId, guests.id),
          )
          .where(
            and(
              eq(guests.externalLinkId, link.id),
              ne(guests.status, "deleted"),
              eq(externalGuestOwners.externalLinkId, link.id),
              eq(externalGuestOwners.ownerKeyHash, ownerKeyHash),
              isNull(externalGuestOwners.releasedAt),
            ),
          )
          .limit(1);
        guestsResult = ownedRows.map((row) => row.guest);
      }
    } else {
      guestsResult = await db.select().from(guests)
        .where(and(eq(guests.externalLinkId, link.id), ne(guests.status, "deleted")));
    }

    const publicLink = toExternalDJLink(link);
    delete publicLink.contributorId;
    return {
      data: {
        link: {
          ...publicLink,
          usedGuests:
            link.kind === "self_rsvp" ? guestsResult.length : link.usedGuests,
        },
        venue,
        guests: guestsResult.map((g) => ({ ...g, status: g.status as Guest["status"] })),
      },
      error: null,
    };
  } catch (error: unknown) {
    await reportServerError("external_link.validate", error);
    return { data: null, error: EXTERNAL_LINK_UNAVAILABLE_ERROR };
  }
}

interface PendingExternalBulkGuest {
  index: number;
  id: string;
  name: string;
  key: string;
  allowDuplicate: boolean;
}

export async function createGuestsViaExternalLink(params: {
  token: string;
  date: string;
  items: BulkGuestCreateInput[];
}): Promise<ApiResponse<BulkGuestCreateResult>> {
  try {
    if (!isValidExternalLinkDate(params.date)) {
      return { data: null, error: "INVALID_DATE" };
    }
    if (!Array.isArray(params.items) || params.items.length > MAX_BULK_WRITE_NAMES) {
      return { data: null, error: "BULK_LIMIT_EXCEEDED" };
    }
    if (params.items.length === 0) {
      return { data: { items: [] }, error: null };
    }

    const { env } = getCloudflareContext();
    const db = getDb();
    const [link] = await db
      .select()
      .from(externalDjLinks)
      .where(eq(externalDjLinks.token, params.token))
      .limit(1);

    if (
      !link ||
      link.deletedAt ||
      !link.active ||
      isExpired(link.expiresAt) ||
      !link.date ||
      !isValidExternalLinkDate(link.date)
    ) {
      return { data: null, error: "Link is invalid, expired, or inactive." };
    }
    const tenant = await getRequestTenantContext();
    if (!tenant.resolved || (tenant.scope === "venue" && tenant.venueId !== link.venueId)) {
      return { data: null, error: "Link is invalid, expired, or inactive." };
    }
    try {
      await requireActiveVenueId(link.venueId);
    } catch {
      return { data: null, error: "Link is invalid, expired, or inactive." };
    }
    if (params.date !== link.date) {
      return { data: null, error: "Guest date does not match this link." };
    }
    if (link.kind === "self_rsvp") {
      return { data: null, error: "SELF_RSVP_BULK_UNSUPPORTED" };
    }
    const event = await resolveEventForRosterWrite({
      venueId: link.venueId,
      businessDate: link.date,
      eventId: link.eventId,
      purpose: "register",
    });
    const requestHeaders = await headers();
    try {
      const rateLimit = await consumeRateLimit({
        namespace: "external-guest-write",
        identifier: `${link.id}:${getRequestIpFromHeaders(requestHeaders)}`,
        limit: EXTERNAL_GUEST_RATE_LIMIT_NAMES,
        windowSeconds: EXTERNAL_GUEST_RATE_LIMIT_WINDOW_SECONDS,
        cost: params.items.length,
      });
      if (!rateLimit.allowed) {
        return { data: null, error: "RATE_LIMITED" };
      }
    } catch {
      // KV is an availability-sensitive, best-effort shield. D1's atomic link
      // state and capacity predicates remain authoritative if KV is delayed or
      // rejects a same-key write.
      await reportServerError("external_link.rate_limit", new Error("Rate limit unavailable"));
    }
    const existingNames = await db
      .select({ name: guests.name })
      .from(guests)
      .where(
        and(
          eq(guests.externalLinkId, link.id),
          ne(guests.status, "deleted"),
        ),
      );
    const seenKeys = new Set<string>();
    for (const existing of existingNames) {
      const prepared = prepareGuestName(existing.name);
      if (prepared.error === null) seenKeys.add(prepared.key);
    }

    const itemResults: BulkGuestCreateItemResult[] = params.items.map((_, index) => ({
      index,
      status: "invalid_name",
      guest: null,
    }));
    const pendingGuests: PendingExternalBulkGuest[] = [];

    for (let index = 0; index < params.items.length; index += 1) {
      const input = parseBulkGuestCreateInput(params.items[index]);
      if (!input) continue;
      const prepared = prepareGuestName(input.name);
      if (prepared.error !== null) continue;

      if (seenKeys.has(prepared.key) && !input.allowDuplicate) {
        itemResults[index] = {
          index,
          status: "duplicate_requires_confirmation",
          guest: null,
        };
        continue;
      }

      seenKeys.add(prepared.key);
      pendingGuests.push({
        index,
        id: crypto.randomUUID(),
        name: toStoredGuestName(prepared.name),
        key: prepared.key,
        allowDuplicate: input.allowDuplicate,
      });
    }

    if (pendingGuests.length === 0) {
      return { data: { items: itemResults }, error: null };
    }

    const now = new Date().toISOString();
    const guardedNames = Array.from(
      new Set(
        pendingGuests
          .filter((pending) => !pending.allowDuplicate)
          .map((pending) => pending.name),
      ),
    );
    const reservation = env.DB.prepare(
      buildExternalGuestReservationSql(guardedNames.length),
    ).bind(
      pendingGuests.length,
      link.id,
      now,
      params.date,
      pendingGuests.length,
      ...guardedNames.flatMap((name) => [link.id, name]),
    );
    const activityIds = pendingGuests.map(() => crypto.randomUUID());
    const inserts = pendingGuests.flatMap((pending, index) => [
      env.DB.prepare(EXTERNAL_GUEST_INSERT_AFTER_RESERVATION_SQL).bind(
        pending.id,
        link.venueId,
        pending.name,
        link.id,
        event.id,
        params.date,
        now,
        now,
      ),
      prepareGuestActivityAfterChange(env.DB, {
        activityId: activityIds[index],
        venueId: link.venueId,
        eventId: event.id,
        guestId: pending.id,
        action: "add",
        actorUserId: null,
        actorType: "external_link",
        channel: "external_link",
        requestId: crypto.randomUUID(),
        previousStatus: null,
        nextStatus: "pending",
        occurredAt: now,
      }),
    ]);
    const writeResults = await env.DB.batch<{ id: string }>([reservation, ...inserts]);
    const reserved = writeResults[0]?.results[0]?.id === link.id;

    if (!reserved) {
      const [currentLink] = await db
        .select()
        .from(externalDjLinks)
        .where(eq(externalDjLinks.id, link.id))
        .limit(1);
      if (
        !currentLink ||
        currentLink.deletedAt ||
        !currentLink.active ||
        isExpired(currentLink.expiresAt) ||
        !currentLink.date ||
        !isValidExternalLinkDate(currentLink.date)
      ) {
        return { data: null, error: "Link is invalid, expired, or inactive." };
      }
      if (currentLink.date && currentLink.date !== params.date) {
        return { data: null, error: "Guest date does not match this link." };
      }
      const concurrentDuplicateRows = guardedNames.length > 0
        ? await db
          .select({ name: guests.name })
          .from(guests)
          .where(
            and(
              eq(guests.externalLinkId, link.id),
              ne(guests.status, "deleted"),
              inArray(guests.name, guardedNames),
            ),
          )
        : [];
      const concurrentDuplicateKeys = new Set(
        concurrentDuplicateRows.flatMap((row) => {
          const prepared = prepareGuestName(row.name);
          return prepared.error === null ? [prepared.key] : [];
        }),
      );
      const rosterChanged = concurrentDuplicateKeys.size > 0;
      for (const pending of pendingGuests) {
        itemResults[pending.index] = {
          index: pending.index,
          status: rosterChanged
            ? !pending.allowDuplicate && concurrentDuplicateKeys.has(pending.key)
              ? "duplicate_requires_confirmation"
              : "batch_changed"
            : "limit_reached",
          guest: null,
        };
      }
      return { data: { items: itemResults }, error: null };
    }

    const allInserted = pendingGuests.every(
      (pending, index) =>
        writeResults[index * 2 + 1]?.results[0]?.id === pending.id &&
        writeResults[index * 2 + 2]?.results[0]?.id === activityIds[index],
    );
    if (!allInserted) throw new Error("External bulk guest insert was not atomic");

    const createdRows = await db
      .select()
      .from(guests)
      .where(inArray(guests.id, pendingGuests.map((pending) => pending.id)));
    const createdById = new Map(createdRows.map((row) => [row.id, row]));
    for (const pending of pendingGuests) {
      const row = createdById.get(pending.id);
      if (!row) throw new Error("External bulk guest insert could not be read back");
      itemResults[pending.index] = {
        index: pending.index,
        status: "created",
        guest: { ...row, status: row.status as Guest["status"] },
      };
    }

    return { data: { items: itemResults }, error: null };
  } catch (error: unknown) {
    await reportServerError("external_link.guest_create", error);
    return {
      data: null,
      error: "Unable to register guests right now. Please try again.",
    };
  }
}

async function findOwnedExternalGuest(
  db: Db,
  linkId: string,
  ownerKeyHash: string,
): Promise<Guest | null> {
  const [row] = await db
    .select({ guest: guests })
    .from(guests)
    .innerJoin(
      externalGuestOwners,
      eq(externalGuestOwners.guestId, guests.id),
    )
    .where(
      and(
        eq(guests.externalLinkId, linkId),
        ne(guests.status, "deleted"),
        eq(externalGuestOwners.externalLinkId, linkId),
        eq(externalGuestOwners.ownerKeyHash, ownerKeyHash),
        isNull(externalGuestOwners.releasedAt),
      ),
    )
    .limit(1);
  return row
    ? { ...row.guest, status: row.guest.status as Guest["status"] }
    : null;
}

async function createSelfRsvpGuest(params: {
  token: string;
  ownerKey: string;
  guestName: string;
  date: string;
}): Promise<ApiResponse<Guest>> {
  if (!isValidExternalOwnerKey(params.ownerKey)) {
    return { data: null, error: "INVALID_SELF_RSVP_OWNER" };
  }
  if (!isValidExternalLinkDate(params.date)) {
    return { data: null, error: "INVALID_DATE" };
  }
  const preparedName = prepareGuestName(params.guestName);
  if (preparedName.error !== null) {
    return { data: null, error: "INVALID_GUEST_NAME" };
  }

  const { env } = getCloudflareContext();
  const db = getDb();
  const [link] = await db
    .select()
    .from(externalDjLinks)
    .where(eq(externalDjLinks.token, params.token))
    .limit(1);
  if (
    !link ||
    link.kind !== "self_rsvp" ||
    link.deletedAt ||
    !link.active ||
    isExpired(link.expiresAt) ||
    !link.date ||
    !isValidExternalLinkDate(link.date)
  ) {
    return { data: null, error: "Link is invalid, expired, or inactive." };
  }
  const tenant = await getRequestTenantContext();
  if (!tenant.resolved || (tenant.scope === "venue" && tenant.venueId !== link.venueId)) {
    return { data: null, error: "Link is invalid, expired, or inactive." };
  }
  try {
    await requireActiveVenueId(link.venueId);
  } catch {
    return { data: null, error: "Link is invalid, expired, or inactive." };
  }
  if (params.date !== link.date) {
    return { data: null, error: "Guest date does not match this link." };
  }

  const ownerKeyHash = await hashOpaqueIdentifier(params.ownerKey);
  const existing = await findOwnedExternalGuest(db, link.id, ownerKeyHash);
  if (existing) return { data: existing, error: null };

  const requestHeaders = await headers();
  try {
    const rateLimit = await consumeRateLimit({
      namespace: "self-rsvp-write",
      identifier: `${link.id}:${getRequestIpFromHeaders(requestHeaders)}`,
      limit: EXTERNAL_GUEST_RATE_LIMIT_NAMES,
      windowSeconds: EXTERNAL_GUEST_RATE_LIMIT_WINDOW_SECONDS,
      cost: 1,
    });
    if (!rateLimit.allowed) return { data: null, error: "RATE_LIMITED" };
  } catch {
    await reportServerError("self_rsvp.rate_limit", new Error("Rate limit unavailable"));
  }

  const event = await resolveEventForRosterWrite({
    venueId: link.venueId,
    businessDate: link.date,
    eventId: link.eventId,
    purpose: "register",
  });
  const id = crypto.randomUUID();
  const activityId = crypto.randomUUID();
  const now = new Date().toISOString();
  const writeResults = await env.DB.batch<{ id?: string; guestId?: string }>([
    env.DB.prepare(RESERVE_SELF_RSVP_SLOT_SQL).bind(
      link.id,
      params.token,
      link.venueId,
      now,
      link.date,
      ownerKeyHash,
    ),
    env.DB.prepare(EXTERNAL_GUEST_INSERT_AFTER_RESERVATION_SQL).bind(
      id,
      link.venueId,
      toStoredGuestName(preparedName.name),
      link.id,
      event.id,
      link.date,
      now,
      now,
    ),
    env.DB.prepare(INSERT_SELF_RSVP_OWNER_AFTER_GUEST_SQL).bind(
      id,
      link.id,
      ownerKeyHash,
      now,
    ),
    prepareGuestActivityAfterChange(env.DB, {
      activityId,
      venueId: link.venueId,
      eventId: event.id,
      guestId: id,
      action: "add",
      actorUserId: null,
      actorType: "external_link",
      channel: "external_link",
      requestId: crypto.randomUUID(),
      previousStatus: null,
      nextStatus: "pending",
      occurredAt: now,
    }),
  ]);

  if (writeResults[0]?.results[0]?.id !== link.id) {
    const concurrent = await findOwnedExternalGuest(db, link.id, ownerKeyHash);
    if (concurrent) return { data: concurrent, error: null };
    return { data: null, error: "Guest limit reached for this link." };
  }
  if (
    writeResults[1]?.results[0]?.id !== id ||
    writeResults[2]?.results[0]?.guestId !== id ||
    writeResults[3]?.results[0]?.id !== activityId
  ) {
    throw new Error("Self RSVP guest insert was not atomic");
  }
  const [created] = await db
    .select()
    .from(guests)
    .where(and(eq(guests.id, id), eq(guests.externalLinkId, link.id)))
    .limit(1);
  if (!created) throw new Error("Self RSVP guest could not be read back");
  return {
    data: { ...created, status: created.status as Guest["status"] },
    error: null,
  };
}

/**
 * 외부 DJ 토큰으로 게스트 생성 (인증 불필요 — 토큰 기반 공개 접근).
 * usedGuests 증가를 D1 원자 UPDATE로 처리하여 race condition 방지.
 */
export async function createGuestViaExternalLink(params: {
  token: string;
  guestName: string;
  date: string;
  ownerKey?: string | null;
}): Promise<ApiResponse<Guest>> {
  try {
    const db = getDb();
    const [link] = await db
      .select({ kind: externalDjLinks.kind })
      .from(externalDjLinks)
      .where(eq(externalDjLinks.token, params.token))
      .limit(1);
    if (link?.kind === "self_rsvp") {
      return await createSelfRsvpGuest({
        token: params.token,
        ownerKey: params.ownerKey ?? "",
        guestName: params.guestName,
        date: params.date,
      });
    }
    const response = await createGuestsViaExternalLink({
      token: params.token,
      date: params.date,
      items: [{ name: params.guestName, allowDuplicate: false }],
    });
    if (response.error || !response.data) {
      return { data: null, error: response.error };
    }

    const [result] = response.data.items;
    if (result?.status === "created" && result.guest) {
      return { data: result.guest, error: null };
    }
    if (result?.status === "limit_reached") {
      return { data: null, error: "Guest limit reached for this link." };
    }
    if (result?.status === "duplicate_requires_confirmation") {
      return { data: null, error: "DUPLICATE_REQUIRES_CONFIRMATION" };
    }
    return {
      data: null,
      error: "Unable to register guest right now. Please try again.",
    };
  } catch (error: unknown) {
    await reportServerError("external_link.guest_create_one", error);
    return {
      data: null,
      error: "Unable to register guest right now. Please try again.",
    };
  }
}

/** Self-RSVP 참가자가 자신의 대기 상태 등록명만 수정한다. */
export async function updateGuestViaExternalLink(params: {
  token: string;
  ownerKey: string;
  guestId: string;
  guestName: string;
}): Promise<ApiResponse<Guest>> {
  try {
    if (!isValidExternalOwnerKey(params.ownerKey)) {
      return { data: null, error: "INVALID_SELF_RSVP_OWNER" };
    }
    const preparedName = prepareGuestName(params.guestName);
    if (preparedName.error !== null) {
      return { data: null, error: "INVALID_GUEST_NAME" };
    }
    const { env } = getCloudflareContext();
    const db = getDb();
    const [link] = await db
      .select()
      .from(externalDjLinks)
      .where(eq(externalDjLinks.token, params.token))
      .limit(1);
    if (
      !link ||
      link.kind !== "self_rsvp" ||
      link.deletedAt ||
      !link.active ||
      isExpired(link.expiresAt) ||
      !link.date ||
      !isValidExternalLinkDate(link.date)
    ) {
      return { data: null, error: "Link is invalid, expired, or inactive." };
    }
    const tenant = await getRequestTenantContext();
    if (!tenant.resolved || (tenant.scope === "venue" && tenant.venueId !== link.venueId)) {
      return { data: null, error: "Link is invalid, expired, or inactive." };
    }
    const ownerKeyHash = await hashOpaqueIdentifier(params.ownerKey);
    const current = await findOwnedExternalGuest(db, link.id, ownerKeyHash);
    if (!current || current.id !== params.guestId || current.status !== "pending") {
      return { data: null, error: "Unable to update this RSVP." };
    }
    const now = new Date().toISOString();
    const activityId = crypto.randomUUID();
    const results = await env.DB.batch<{ id?: string }>([
      env.DB.prepare(UPDATE_SELF_RSVP_GUEST_SQL).bind(
        toStoredGuestName(preparedName.name),
        now,
        params.guestId,
        link.id,
        link.venueId,
        link.date,
        ownerKeyHash,
        params.token,
        now,
      ),
      prepareGuestActivityAfterChange(env.DB, {
        activityId,
        venueId: link.venueId,
        eventId: current.eventId ?? link.eventId,
        guestId: current.id,
        action: "update",
        actorUserId: null,
        actorType: "external_link",
        channel: "external_link",
        requestId: crypto.randomUUID(),
        previousStatus: current.status,
        nextStatus: current.status,
        occurredAt: now,
      }),
    ]);
    if (
      results[0]?.results[0]?.id !== current.id ||
      results[1]?.results[0]?.id !== activityId
    ) {
      return { data: null, error: "Unable to update this RSVP." };
    }
    const updated = await findOwnedExternalGuest(db, link.id, ownerKeyHash);
    return updated
      ? { data: updated, error: null }
      : { data: null, error: "Unable to update this RSVP." };
  } catch (error: unknown) {
    await reportServerError("self_rsvp.guest_update", error);
    return { data: null, error: "Unable to update this RSVP right now." };
  }
}

/** 외부 DJ 토큰으로 게스트 삭제 (토큰 기반). 소유권 검증 포함. */
export async function deleteGuestViaExternalLink(params: {
  token: string;
  guestId: string;
  ownerKey?: string | null;
}): Promise<{ error: string | null }> {
  try {
    const { env } = getCloudflareContext();
    const db = getDb();

    const linkResult = await db.select().from(externalDjLinks)
      .where(eq(externalDjLinks.token, params.token));
    const link = linkResult[0];

    if (
      !link ||
      link.deletedAt ||
      !link.active ||
      isExpired(link.expiresAt) ||
      !link.date ||
      !isValidExternalLinkDate(link.date)
    ) {
      return { error: "Link is invalid, expired, or inactive." };
    }

    const tenant = await getRequestTenantContext();
    if (!tenant.resolved || (tenant.scope === "venue" && tenant.venueId !== link.venueId)) {
      return { error: "Link is invalid, expired, or inactive." };
    }
    try {
      await requireActiveVenueId(link.venueId);
    } catch {
      return { error: "Link is invalid, expired, or inactive." };
    }

    let ownerKeyHash: string | null = null;
    let guest: Pick<Guest, "id" | "status" | "externalLinkId"> | null = null;
    if (link.kind === "self_rsvp") {
      if (!isValidExternalOwnerKey(params.ownerKey)) {
        return { error: "Unable to delete this RSVP." };
      }
      ownerKeyHash = await hashOpaqueIdentifier(params.ownerKey);
      const owned = await findOwnedExternalGuest(db, link.id, ownerKeyHash);
      if (owned?.id === params.guestId) guest = owned;
    } else {
      const [candidate] = await db
        .select({
          id: guests.id,
          externalLinkId: guests.externalLinkId,
          status: guests.status,
        })
        .from(guests)
        .where(eq(guests.id, params.guestId))
        .limit(1);
      if (candidate?.externalLinkId === link.id) {
        guest = { ...candidate, status: candidate.status as Guest["status"] };
      }
    }
    if (!guest || guest.status !== "pending") {
      return { error: "Unable to delete this guest from this link." };
    }

    const now = new Date().toISOString();
    const activityId = crypto.randomUUID();
    const decrement = link.kind === "self_rsvp"
      ? env.DB.prepare(DECREMENT_SELF_RSVP_FOR_PENDING_GUEST_SQL).bind(
          link.id,
          params.token,
          link.venueId,
          now,
          link.date,
          params.guestId,
          link.id,
          link.venueId,
          link.date,
          ownerKeyHash,
        )
      : env.DB.prepare(DECREMENT_EXTERNAL_LINK_FOR_PENDING_GUEST_SQL).bind(
          link.id,
          params.token,
          link.venueId,
          now,
          link.date,
          params.guestId,
          link.id,
          link.venueId,
          link.date,
        );
    const softDelete = env.DB.prepare(
      SOFT_DELETE_EXTERNAL_GUEST_AFTER_DECREMENT_SQL,
    ).bind(
      now,
      params.guestId,
      link.id,
      link.venueId,
      link.date,
    );
    const activity = prepareGuestActivityAfterChange(env.DB, {
        activityId,
        venueId: link.venueId,
        eventId: link.eventId,
        guestId: params.guestId,
        action: "delete",
        actorUserId: null,
        actorType: "external_link",
        channel: "external_link",
        requestId: crypto.randomUUID(),
        previousStatus: guest.status,
        nextStatus: "deleted",
        occurredAt: now,
      });
    const deleteResults = await env.DB.batch<{ id?: string }>([
      decrement,
      softDelete,
      activity,
    ]);
    if (
      deleteResults[0]?.results[0]?.id !== link.id ||
      deleteResults[1]?.results[0]?.id !== params.guestId ||
      deleteResults[2]?.results[0]?.id !== activityId
    ) {
      return { error: "Unable to delete this guest from this link." };
    }

    return { error: null };
  } catch (error: unknown) {
    await reportServerError("external_link.guest_delete", error);
    return { error: "Unable to delete guest right now. Please try again." };
  }
}

"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { eq, and, ne, desc, inArray, isNull } from "drizzle-orm";
import { externalDjLinks, venues, guests } from "../db/schema";
import {
  type ApiResponse,
  type BulkGuestCreateInput,
  type BulkGuestCreateItemResult,
  type BulkGuestCreateResult,
  type ExternalDJLink,
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
  DECREMENT_EXTERNAL_LINK_FOR_PENDING_GUEST_SQL,
  EXTERNAL_GUEST_INSERT_AFTER_RESERVATION_SQL,
  SOFT_DELETE_EXTERNAL_GUEST_AFTER_DECREMENT_SQL,
} from "@/lib/guests/atomic-sql";
import {
  getExternalLinkDeletionDisposition,
  isValidExternalLinkDate,
  prepareExternalLinkCreateInput,
  toExternalDJLink,
} from "../external-links/domain";

type Db = ReturnType<typeof getDb>;

const DEFAULT_EXTERNAL_LINK_TTL_DAYS = 7;
const EXTERNAL_GUEST_RATE_LIMIT_NAMES = 100;
const EXTERNAL_GUEST_RATE_LIMIT_WINDOW_SECONDS = 60;
const INVALID_EXTERNAL_LINK_ERROR = "INVALID_EXTERNAL_LINK";
const EXTERNAL_LINK_UNAVAILABLE_ERROR = "EXTERNAL_LINK_UNAVAILABLE";

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
    console.error("Failed to fetch external links:", error);
    return { data: null, error: "Unable to load external links right now." };
  }
}

export async function fetchExternalLinksByDate(venueId: string, date: string): Promise<ApiResponse<ExternalDJLink[]>> {
  try {
    const user = await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    const effectiveVenueId = await scopedVenueId(user, venueId);
    const result = await db.select().from(externalDjLinks)
      .where(
        and(
          eq(externalDjLinks.venueId, effectiveVenueId),
          eq(externalDjLinks.date, date),
          isNull(externalDjLinks.deletedAt),
        ),
      )
      .orderBy(desc(externalDjLinks.createdAt));
    return { data: await addGuestUrls(effectiveVenueId, result), error: null };
  } catch (error: unknown) {
    console.error("Failed to fetch external links by date:", error);
    return { data: null, error: "Unable to load external links right now." };
  }
}

export async function fetchRecentExternalLinks(
  venueId: string,
  limit: 5 | 10,
): Promise<ApiResponse<ExternalDJLink[]>> {
  try {
    const user = await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    const effectiveVenueId = await scopedVenueId(user, venueId);
    const normalizedLimit = limit === 10 ? 10 : 5;
    const result = await db
      .select()
      .from(externalDjLinks)
      .where(
        and(
          eq(externalDjLinks.venueId, effectiveVenueId),
          isNull(externalDjLinks.deletedAt),
        ),
      )
      .orderBy(desc(externalDjLinks.createdAt), desc(externalDjLinks.date))
      .limit(normalizedLimit);
    return { data: await addGuestUrls(effectiveVenueId, result), error: null };
  } catch (error: unknown) {
    console.error("Failed to fetch recent external links:", error);
    return { data: null, error: "Unable to load recent external links right now." };
  }
}

export async function createExternalLink(link: {
  venueId: string;
  djName: string;
  event: string;
  date: string;
  maxGuests: number;
  localeMode?: ExternalDJLink["localeMode"];
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
    const expiresAt = defaultExternalLinkExpiresAt(draft.date);
    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await db.insert(externalDjLinks).values({
      id,
      venueId: effectiveVenueId,
      token,
      djName: draft.djName,
      event: draft.event,
      date: draft.date,
      maxGuests: draft.maxGuests,
      localeMode: draft.localeMode,
      usedGuests: 0,
      active: true,
      expiresAt,
      createdBy: user.id,
      createdAt,
    });
    const result = await db.select().from(externalDjLinks).where(eq(externalDjLinks.id, id));
    const withGuestUrl = result[0]
      ? (await addGuestUrls(effectiveVenueId, [result[0]]))[0]
      : null;
    return { data: withGuestUrl, error: null };
  } catch (error: unknown) {
    console.error("Failed to create external link:", error);
    return { data: null, error: "Unable to create external link right now." };
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
    console.error("Failed to delete external link:", error);
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
    console.error("Failed to deactivate external link:", error);
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
    console.error("Failed to activate external link:", error);
    return { error: "Unable to update external link right now." };
  }
}

/** 외부 DJ 토큰 검증 (인증 불필요 — 토큰 기반 공개 접근) */
export async function validateExternalToken(token: string): Promise<ApiResponse<{ link: ExternalDJLink; venue: Venue; guests: Guest[] }>> {
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

    const guestsResult = await db.select().from(guests)
      .where(and(eq(guests.externalLinkId, link.id), ne(guests.status, "deleted")));

    return {
      data: {
        link: toExternalDJLink(link),
        venue,
        guests: guestsResult.map((g) => ({ ...g, status: g.status as Guest["status"] })),
      },
      error: null,
    };
  } catch (error: unknown) {
    console.error("Failed to validate external token:", error);
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
      console.warn("External guest rate limit unavailable; using D1 guards.");
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
    const inserts = pendingGuests.map((pending) =>
      env.DB.prepare(EXTERNAL_GUEST_INSERT_AFTER_RESERVATION_SQL).bind(
        pending.id,
        link.venueId,
        pending.name,
        link.id,
        params.date,
        now,
        now,
      ),
    );
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
      (pending, index) => writeResults[index + 1]?.results[0]?.id === pending.id,
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
    console.error("Failed to create guests via external link:", error);
    return {
      data: null,
      error: "Unable to register guests right now. Please try again.",
    };
  }
}

/**
 * 외부 DJ 토큰으로 게스트 생성 (인증 불필요 — 토큰 기반 공개 접근).
 * usedGuests 증가를 D1 원자 UPDATE로 처리하여 race condition 방지.
 */
export async function createGuestViaExternalLink(params: {
  token: string;
  guestName: string;
  date: string;
}): Promise<ApiResponse<Guest>> {
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
}

/** 외부 DJ 토큰으로 게스트 삭제 (토큰 기반). 소유권 검증 포함. */
export async function deleteGuestViaExternalLink(params: {
  token: string;
  guestId: string;
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

    // 소유권 검증: guest가 이 link에 속하는지 확인
    const guestResult = await db.select({ externalLinkId: guests.externalLinkId, status: guests.status })
      .from(guests)
      .where(eq(guests.id, params.guestId))
      .limit(1);

    const guest = guestResult[0];
    if (!guest || guest.externalLinkId !== link.id) {
      return { error: "Unable to delete this guest from this link." };
    }

    const now = new Date().toISOString();
    const deleteResults = await env.DB.batch<{ id: string }>([
      env.DB.prepare(DECREMENT_EXTERNAL_LINK_FOR_PENDING_GUEST_SQL).bind(
        link.id,
        params.token,
        link.venueId,
        now,
        link.date,
        params.guestId,
        link.id,
        link.venueId,
        link.date,
      ),
      env.DB.prepare(SOFT_DELETE_EXTERNAL_GUEST_AFTER_DECREMENT_SQL).bind(
        now,
        params.guestId,
        link.id,
        link.venueId,
        link.date,
      ),
    ]);
    if (
      deleteResults[0]?.results[0]?.id !== link.id ||
      deleteResults[1]?.results[0]?.id !== params.guestId
    ) {
      return { error: "Unable to delete this guest from this link." };
    }

    return { error: null };
  } catch (error: unknown) {
    console.error("Failed to delete guest via external link:", error);
    return { error: "Unable to delete guest right now. Please try again." };
  }
}

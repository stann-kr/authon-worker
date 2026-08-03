"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq, and, ne, desc, sql } from "drizzle-orm";
import { externalDjLinks, venues, guests } from "../db/schema";
import { type ExternalDJLink, type Guest, type Venue, type ApiResponse } from "./types";
import { requireRole, type SessionUser } from "../auth/server";
import { getDb } from "../db/client";
import { getRequestTenantContext, getVenueDeliveryContext } from "../tenant/server";

type Db = ReturnType<typeof getDb>;

const DEFAULT_EXTERNAL_LINK_TTL_DAYS = 7;

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

function scopedVenueId(user: SessionUser, requestedVenueId: string): string {
  if (user.role === "super_admin") return requestedVenueId;
  if (!user.venueId || requestedVenueId !== user.venueId) throw new Error("Forbidden");
  return user.venueId;
}

async function getAccessibleLink(db: Db, user: SessionUser, linkId: string) {
  const rows = await db.select().from(externalDjLinks).where(eq(externalDjLinks.id, linkId)).limit(1);
  const link = rows[0];
  if (!link) throw new Error("External link not found");
  if (user.role !== "super_admin" && link.venueId !== user.venueId) throw new Error("Forbidden");
  return link;
}

function isExpired(expiresAt?: string | null): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() <= Date.now();
}

async function addGuestUrls<T extends typeof externalDjLinks.$inferSelect>(
  venueId: string,
  links: T[],
): Promise<Array<T & { guestUrl: string }>> {
  const { baseUrl } = await getVenueDeliveryContext(venueId);
  return links.map((link) => ({
    ...link,
    guestUrl: `${baseUrl}/guest?token=${encodeURIComponent(link.token)}`,
  }));
}

export async function fetchExternalLinks(venueId: string): Promise<ApiResponse<ExternalDJLink[]>> {
  try {
    const user = await requireRole(["super_admin", "venue_admin", "door_staff", "staff"]);
    const db = getDb();
    const effectiveVenueId = scopedVenueId(user, venueId);
    const result = await db.select().from(externalDjLinks)
      .where(eq(externalDjLinks.venueId, effectiveVenueId))
      .orderBy(desc(externalDjLinks.createdAt), desc(externalDjLinks.date));
    return { data: await addGuestUrls(effectiveVenueId, result), error: null };
  } catch (error: unknown) {
    console.error("Failed to fetch external links:", error);
    return { data: null, error: "Unable to load external links right now." };
  }
}

export async function fetchExternalLinksByDate(venueId: string, date: string): Promise<ApiResponse<ExternalDJLink[]>> {
  try {
    const user = await requireRole(["super_admin", "venue_admin", "door_staff", "staff"]);
    const db = getDb();
    const effectiveVenueId = scopedVenueId(user, venueId);
    const result = await db.select().from(externalDjLinks)
      .where(and(eq(externalDjLinks.venueId, effectiveVenueId), eq(externalDjLinks.date, date)))
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
    const user = await requireRole(["super_admin", "venue_admin", "door_staff", "staff"]);
    const db = getDb();
    const effectiveVenueId = scopedVenueId(user, venueId);
    const normalizedLimit = limit === 10 ? 10 : 5;
    const result = await db
      .select()
      .from(externalDjLinks)
      .where(eq(externalDjLinks.venueId, effectiveVenueId))
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
  createdBy?: string;
}): Promise<ApiResponse<ExternalDJLink>> {
  try {
    const user = await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    const effectiveVenueId = scopedVenueId(user, link.venueId);
    const expiresAt = defaultExternalLinkExpiresAt(link.date);
    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await db.insert(externalDjLinks).values({
      id,
      venueId: effectiveVenueId,
      token,
      djName: link.djName,
      event: link.event,
      date: link.date,
      maxGuests: link.maxGuests,
      usedGuests: 0,
      active: true,
      expiresAt,
      createdBy: user.role === "super_admin" ? (link.createdBy || user.id) : user.id,
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
    await db.delete(externalDjLinks).where(eq(externalDjLinks.id, linkId));
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
    if (isExpired(link.expiresAt)) throw new Error("Link is expired");
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

    if (!link || !link.active || isExpired(link.expiresAt)) {
      return { data: null, error: "Link is invalid, expired, or inactive." };
    }

    const tenant = await getRequestTenantContext();
    if (!tenant.resolved || (tenant.scope === "venue" && tenant.venueId !== link.venueId)) {
      return { data: null, error: "Link is invalid, expired, or inactive." };
    }

    const venueResult = await db.select().from(venues).where(eq(venues.id, link.venueId));
    const venue = venueResult[0] as Venue;

    if (!venue) {
      return { data: null, error: "Associated venue not found." };
    }

    const guestsResult = await db.select().from(guests)
      .where(and(eq(guests.externalLinkId, link.id), ne(guests.status, "deleted")));

    return {
      data: {
        link,
        venue,
        guests: guestsResult.map((g) => ({ ...g, status: g.status as Guest["status"] })),
      },
      error: null,
    };
  } catch (error: unknown) {
    console.error("Failed to validate external token:", error);
    return { data: null, error: "Link is invalid, expired, or inactive." };
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
  try {
    const { env } = getCloudflareContext();
    const db = getDb();

    const linkResult = await db.select().from(externalDjLinks)
      .where(eq(externalDjLinks.token, params.token));
    const link = linkResult[0];

    if (!link || !link.active || isExpired(link.expiresAt)) {
      return { data: null, error: "Link is invalid, expired, or inactive." };
    }

    const tenant = await getRequestTenantContext();
    if (!tenant.resolved || (tenant.scope === "venue" && tenant.venueId !== link.venueId)) {
      return { data: null, error: "Link is invalid, expired, or inactive." };
    }

    if (link.date && params.date !== link.date) {
      return { data: null, error: "Guest date does not match this link." };
    }

    // 원자적 정원 체크 + 증가: used_guests < max_guests 인 경우에만 UPDATE
    const updated = await env.DB.prepare(
      "UPDATE external_dj_links SET used_guests = used_guests + 1 WHERE id = ? AND active = 1 AND used_guests < max_guests RETURNING used_guests"
    ).bind(link.id).first<{ used_guests: number }>();

    if (!updated) {
      return { data: null, error: "Guest limit reached for this link." };
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      await db.insert(guests).values({
        id,
        venueId: link.venueId,
        name: params.guestName,
        externalLinkId: link.id,
        date: params.date,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
    } catch (insertError) {
      await db.update(externalDjLinks)
        .set({ usedGuests: sql`max(0, ${externalDjLinks.usedGuests} - 1)` })
        .where(eq(externalDjLinks.id, link.id));
      throw insertError;
    }

    const result = await db.select().from(guests).where(eq(guests.id, id));
    return { data: result[0] ? { ...result[0], status: result[0].status as Guest["status"] } : null, error: null };
  } catch (error: unknown) {
    console.error("Failed to create guest via external link:", error);
    return { data: null, error: "Unable to register guest right now. Please try again." };
  }
}

/** 외부 DJ 토큰으로 게스트 삭제 (토큰 기반). 소유권 검증 포함. */
export async function deleteGuestViaExternalLink(params: {
  token: string;
  guestId: string;
}): Promise<{ error: string | null }> {
  try {
    const db = getDb();

    const linkResult = await db.select().from(externalDjLinks)
      .where(eq(externalDjLinks.token, params.token));
    const link = linkResult[0];

    if (!link || !link.active || isExpired(link.expiresAt)) {
      return { error: "Link is invalid, expired, or inactive." };
    }

    const tenant = await getRequestTenantContext();
    if (!tenant.resolved || (tenant.scope === "venue" && tenant.venueId !== link.venueId)) {
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

    const wasAlreadyDeleted = guest.status === "deleted";
    await db.update(guests)
      .set({ status: "deleted", updatedAt: new Date().toISOString() })
      .where(eq(guests.id, params.guestId));

    if (!wasAlreadyDeleted) {
      await db.update(externalDjLinks)
        .set({ usedGuests: sql`max(0, ${externalDjLinks.usedGuests} - 1)` })
        .where(eq(externalDjLinks.id, link.id));
    }

    return { error: null };
  } catch (error: unknown) {
    console.error("Failed to delete guest via external link:", error);
    return { error: "Unable to delete guest right now. Please try again." };
  }
}

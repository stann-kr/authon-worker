"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq, and, ne, desc } from "drizzle-orm";
import * as schema from "../db/schema";
import { externalDjLinks, venues, guests } from "../db/schema";
import { type ExternalDJLink, type Guest, type Venue, type ApiResponse } from "./types";
import { deleteGuest } from "./guests";
import { requireRole } from "../auth/server";
import { getDb } from "../db/client";

export async function fetchExternalLinks(venueId: string): Promise<ApiResponse<ExternalDJLink[]>> {
  try {
    await requireRole(["super_admin", "venue_admin", "door_staff", "staff"]);
    const db = getDb();
    const result = await db.select().from(externalDjLinks)
      .where(eq(externalDjLinks.venueId, venueId))
      .orderBy(desc(externalDjLinks.date));
    return { data: result, error: null };
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to fetch external links" };
  }
}

export async function fetchExternalLinksByDate(venueId: string, date: string): Promise<ApiResponse<ExternalDJLink[]>> {
  try {
    await requireRole(["super_admin", "venue_admin", "door_staff", "staff"]);
    const db = getDb();
    const result = await db.select().from(externalDjLinks)
      .where(and(eq(externalDjLinks.venueId, venueId), eq(externalDjLinks.date, date)))
      .orderBy(desc(externalDjLinks.id));
    return { data: result, error: null };
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to fetch external links by date" };
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
    await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    await db.insert(externalDjLinks).values({
      id,
      venueId: link.venueId,
      token,
      djName: link.djName,
      event: link.event,
      date: link.date,
      maxGuests: link.maxGuests,
      usedGuests: 0,
      active: true,
      createdBy: link.createdBy || null,
    });
    const result = await db.select().from(externalDjLinks).where(eq(externalDjLinks.id, id));
    return { data: result[0] ? { ...result[0] } : null, error: null };
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to create external link" };
  }
}

export async function deleteExternalLink(linkId: string): Promise<{ error: string | null }> {
  try {
    await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    await db.delete(externalDjLinks).where(eq(externalDjLinks.id, linkId));
    return { error: null };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Failed to delete external link" };
  }
}

export async function deactivateExternalLink(linkId: string): Promise<{ error: string | null }> {
  try {
    await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    await db.update(externalDjLinks).set({ active: false }).where(eq(externalDjLinks.id, linkId));
    return { error: null };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Failed to deactivate external link" };
  }
}

export async function activateExternalLink(linkId: string): Promise<{ error: string | null }> {
  try {
    await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    await db.update(externalDjLinks).set({ active: true }).where(eq(externalDjLinks.id, linkId));
    return { error: null };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Failed to activate external link" };
  }
}

/** 외부 DJ 토큰 검증 (인증 불필요 — 토큰 기반 공개 접근) */
export async function validateExternalToken(token: string): Promise<ApiResponse<{ link: ExternalDJLink; venue: Venue; guests: Guest[] }>> {
  try {
    const db = getDb();
    const linkResult = await db.select().from(externalDjLinks).where(eq(externalDjLinks.token, token));
    const link = linkResult[0];

    if (!link || !link.active) {
      return { data: null, error: "Link is invalid or inactive." };
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
    return { data: null, error: error instanceof Error ? error.message : "Failed to validate external token" };
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

    if (!link || !link.active) {
      return { data: null, error: "Link is invalid or inactive." };
    }

    // 원자적 정원 체크 + 증가: used_guests < max_guests 인 경우에만 UPDATE
    const updated = await env.DB.prepare(
      "UPDATE external_dj_links SET used_guests = used_guests + 1 WHERE id = ? AND used_guests < max_guests RETURNING used_guests"
    ).bind(link.id).first<{ used_guests: number }>();

    if (!updated) {
      return { data: null, error: "Guest limit reached for this link." };
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

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

    const result = await db.select().from(guests).where(eq(guests.id, id));
    return { data: result[0] ? { ...result[0], status: result[0].status as Guest["status"] } : null, error: null };
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to create guest via external link" };
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

    if (!link || !link.active) {
      return { error: "Link is invalid or inactive." };
    }

    // 소유권 검증: guest가 이 link에 속하는지 확인
    const guestResult = await db.select({ externalLinkId: guests.externalLinkId })
      .from(guests)
      .where(eq(guests.id, params.guestId))
      .limit(1);

    const guest = guestResult[0];
    if (!guest || guest.externalLinkId !== link.id) {
      return { error: "Forbidden: guest does not belong to this link." };
    }

    const result = await deleteGuest(params.guestId);
    return { error: result.error };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Failed to delete guest via external link" };
  }
}

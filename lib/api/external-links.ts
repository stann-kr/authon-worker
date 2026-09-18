"use server";

import { measureServerOperation } from "@/lib/observability/server-performance";

import { reportServerError } from "@/lib/observability/structured-log";

import { getD1Database } from "@/lib/db/client";
import { buildLinkGuestQuery, buildLinkListQuery } from "../external-links/list-query";
import { LINK_PAGE_SIZE, type LinkListCursor, type LinkListOptions } from "../external-links/list-types";
import { headers } from "next/headers";
import {
  eq,
  and,
  desc,
  isNull,
} from "drizzle-orm";
import { externalDjLinks, guests } from "../db/schema";
import type { ApiResponse } from "./response";
import type {
  BulkGuestCreateInput,
} from "@/lib/guests/types";
import type { ExternalDjSuggestion } from "@/lib/contributors/types";
import type {
  ExternalDJLink,
  ExternalLinkPage,
  ExternalLinkGuestPage,
  ExternalLinkCreateSuggestions,
  ExternalLinkPublicGuest,
  ExternalLinkPublicGuestCreateResult,
  ExternalLinkPublicValidationData,
} from "@/lib/external-links/types";
import { requireRole, type SessionUser } from "../auth/server";
import {
  consumeRateLimit,
  getRequestIpFromHeaders,
} from "../auth/rate-limit";
import { getDb } from "../db/client";
import { getRequestTenantContext, getVenueDeliveryContext } from "../tenant/server";
import { requireActiveVenueId } from "../tenant/active-server";
import {
  prepareExternalLinkCreateInput,
  toExternalDJLink,
} from "../external-links/domain";
import {
  createExternalLinkAdminPersistence,
  createExternalLinkLifecyclePersistence,
} from "@/lib/external-links/persistence";
import {
  activateAdminExternalLink,
  createAdminExternalLink,
  deactivateAdminExternalLink,
  deleteAdminExternalLink,
  ExternalLinkAdminError,
  fetchAdminExternalDjDirectory,
  fetchAdminExternalLinkCreateSuggestions,
  type ExternalLinkLifecycleActor,
} from "@/lib/external-links/service";
import { createExternalLinkPublicPersistence } from "@/lib/external-links/public-persistence";
import {
  createPublicGuestsViaExternalLink,
  createPublicSelfRsvpGuest,
  deletePublicGuestViaExternalLink,
  loadPublicExternalLinkKind,
  updatePublicGuestViaExternalLink,
  validatePublicExternalToken,
} from "@/lib/external-links/public-service";
import {
  eventIncludesLegacyDateRows,
  findCompatibilityEvent,
  loadEventById,
  resolveEventForRosterWrite,
} from "@/lib/events/server";

async function scopedVenueId(user: SessionUser, requestedVenueId: string): Promise<string> {
  if (!requestedVenueId) throw new Error("Venue is required");
  const venueId = user.role === "super_admin" ? requestedVenueId : user.venueId;
  if (!venueId || requestedVenueId !== venueId) throw new Error("Forbidden");
  return requireActiveVenueId(venueId);
}

function toExternalLinkLifecycleActor(
  user: SessionUser,
): ExternalLinkLifecycleActor {
  return {
    userId: user.id,
    role: user.role,
    accountKind: user.accountKind,
    venueId: user.venueId,
    sessionVersion: user.sessionVersion,
  };
}

function getExternalLinkLifecyclePersistence() {
  return createExternalLinkLifecyclePersistence(getD1Database());
}

function getExternalLinkAdminPersistence() {
  return createExternalLinkAdminPersistence(getD1Database());
}

function getExternalLinkPublicDependencies() {
  return {
    persistence: createExternalLinkPublicPersistence(getD1Database()),
    getTenantContext: getRequestTenantContext,
    async getRequestIp() {
      return getRequestIpFromHeaders(await headers());
    },
    consumeRateLimit,
    async onRateLimitUnavailable(
      scope: "external_guest" | "self_rsvp",
    ) {
      await reportServerError(
        scope === "self_rsvp"
          ? "self_rsvp.rate_limit"
          : "external_link.rate_limit",
        new Error("Rate limit unavailable"),
      );
    },
    resolveEventForRosterWrite,
  };
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
  return measureServerOperation("server.external_link_list", async (): Promise<ApiResponse<ExternalDJLink[]>> => {
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
  });
}

export async function fetchExternalLinkPage(
  venueId: string,
  options: LinkListOptions,
): Promise<ApiResponse<ExternalLinkPage>> {
  try {
    const user = await requireRole(["super_admin", "venue_admin"]);
    const effectiveVenueId = await scopedVenueId(user, venueId);
    if (!options || !["all", "active", "attention"].includes(options.filter) ||
      !["newest", "expiresSoonest", "djName"].includes(options.sort) ||
      (options.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(options.date)) ||
      (options.cursor && (typeof options.cursor.id !== "string" || !options.cursor.id || options.cursor.id.length > 200 ||
        typeof options.cursor.value !== "string" || options.cursor.value.length > 500))) throw new Error("INVALID_LINK_PAGE");
    const db = getDb();
    let scopedEventId: string | null = null;
    let includeLegacy = false;
    if (options.date) {
      if (options.eventId) {
        const event = await loadEventById(db, options.eventId);
        if (!event || event.venueId !== effectiveVenueId || event.businessDate !== options.date) throw new Error("EVENT_NOT_FOUND");
        scopedEventId = event.id;
      } else {
        const event = await findCompatibilityEvent(effectiveVenueId, options.date);
        if (event && eventIncludesLegacyDateRows(event)) { scopedEventId = event.id; includeLegacy = true; }
      }
    }
    const query = buildLinkListQuery(effectiveVenueId, options, scopedEventId, includeLegacy);
    const [rows, counts] = await Promise.all([
      db.select({ link: externalDjLinks, cursorValue: query.value.as("cursorValue") }).from(externalDjLinks)
        .where(query.where).orderBy(...query.order).limit(LINK_PAGE_SIZE + 1),
      db.select(query.stats).from(externalDjLinks).where(query.scope),
    ]);
    const page = rows.slice(0, LINK_PAGE_SIZE);
    const last = page.at(-1);
    return { data: {
      links: await addGuestUrls(effectiveVenueId, page.map((row) => row.link)),
      nextCursor: rows.length > LINK_PAGE_SIZE && last ? { value: last.cursorValue, id: last.link.id } : null,
      stats: counts[0],
    }, error: null };
  } catch (error: unknown) {
    await reportServerError("external_link.list_page", error);
    return { data: null, error: "Unable to load external links right now." };
  }
}

export async function fetchExternalLinkGuests(
  venueId: string,
  linkId: string,
  cursor?: LinkListCursor | null,
): Promise<ApiResponse<ExternalLinkGuestPage>> {
  try {
    const user = await requireRole(["super_admin", "venue_admin"]);
    const effectiveVenueId = await scopedVenueId(user, venueId);
    if (typeof linkId !== "string" || !linkId || linkId.length > 200 ||
      (cursor && (typeof cursor.id !== "string" || !cursor.id || cursor.id.length > 200 ||
        typeof cursor.value !== "string" || cursor.value.length > 64))) throw new Error("INVALID_LINK_GUEST_PAGE");
    const db = getDb();
    const [link] = await db.select({ id: externalDjLinks.id }).from(externalDjLinks)
      .where(and(eq(externalDjLinks.id, linkId), eq(externalDjLinks.venueId, effectiveVenueId), isNull(externalDjLinks.deletedAt))).limit(1);
    if (!link) throw new Error("LINK_NOT_FOUND");
    const query = buildLinkGuestQuery(effectiveVenueId, linkId, cursor);
    const rows = await db.select({ id: guests.id, name: guests.name, status: guests.status,
      createdAt: guests.createdAt, checkInTime: guests.checkInTime })
      .from(guests).innerJoin(externalDjLinks, query.join).where(query.where)
      .orderBy(...query.order).limit(LINK_PAGE_SIZE + 1);
    const page = rows.slice(0, LINK_PAGE_SIZE);
    const last = page.at(-1);
    return { data: {
      guests: page.map((guest) => ({ ...guest, status: guest.status as "pending" | "checked" })),
      nextCursor: rows.length > LINK_PAGE_SIZE && last ? { id: last.id, value: last.createdAt } : null,
    }, error: null };
  } catch (error) {
    await reportServerError("external_link.guests", error);
    return { data: null, error: "Unable to load registered guests right now." };
  }
}

export async function fetchExternalDjDirectory(
  venueId: string,
): Promise<ApiResponse<ExternalDjSuggestion[]>> {
  try {
    const user = await requireRole(["super_admin", "venue_admin"]);
    const rows = await fetchAdminExternalDjDirectory(
      {
        actor: toExternalLinkLifecycleActor(user),
        requestedVenueId: venueId,
      },
      { persistence: getExternalLinkAdminPersistence() },
    );
    return { data: rows, error: null };
  } catch (error: unknown) {
    await reportServerError("external_dj.directory", error);
    return {
      data: null,
      error:
        error instanceof ExternalLinkAdminError &&
        error.code === "DJ_DIRECTORY_TOO_LARGE"
          ? error.code
          : "DJ_DIRECTORY_UNAVAILABLE",
    };
  }
}

export async function fetchExternalLinkCreateSuggestions(
  venueId: string,
): Promise<ApiResponse<ExternalLinkCreateSuggestions>> {
  try {
    const user = await requireRole(["super_admin", "venue_admin"]);
    const data = await fetchAdminExternalLinkCreateSuggestions(
      {
        actor: toExternalLinkLifecycleActor(user),
        requestedVenueId: venueId,
      },
      { persistence: getExternalLinkAdminPersistence() },
    );
    return { data, error: null };
  } catch (error: unknown) {
    await reportServerError("external_link.create_suggestions", error);
    return { data: null, error: "CREATE_SUGGESTIONS_UNAVAILABLE" };
  }
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
    // Preserve the legacy authorization/error precedence before input parsing;
    // the capability service repeats this boundary for direct internal calls.
    await scopedVenueId(user, link.venueId);
    const prepared = prepareExternalLinkCreateInput(link);
    if (prepared.error || !prepared.draft) {
      return { data: null, error: prepared.error ?? "INVALID_EXTERNAL_LINK_INPUT" };
    }
    const created = await createAdminExternalLink(
      {
        actor: toExternalLinkLifecycleActor(user),
        requestedVenueId: link.venueId,
        eventId: link.eventId,
        draft: prepared.draft,
      },
      {
        persistence: getExternalLinkAdminPersistence(),
        resolveEventForRosterWrite,
      },
    );
    const withGuestUrl = created
      ? (await addGuestUrls(created.venueId, [created]))[0]
      : null;
    return { data: withGuestUrl, error: null };
  } catch (error: unknown) {
    await reportServerError("external_link.create", error);
    return {
      data: null,
      error:
        error instanceof ExternalLinkAdminError &&
        error.code === "INVALID_CONTRIBUTOR"
          ? error.code
          : "Unable to create external link right now.",
    };
  }
}

export async function deleteExternalLink(linkId: string): Promise<{ error: string | null }> {
  try {
    const user = await requireRole(["super_admin", "venue_admin"]);
    await deleteAdminExternalLink(
      { linkId, actor: toExternalLinkLifecycleActor(user) },
      { persistence: getExternalLinkLifecyclePersistence() },
    );

    return { error: null };
  } catch (error: unknown) {
    await reportServerError("external_link.delete", error);
    return { error: "Unable to delete external link right now." };
  }
}

export async function deactivateExternalLink(linkId: string): Promise<{ error: string | null }> {
  try {
    const user = await requireRole(["super_admin", "venue_admin"]);
    await deactivateAdminExternalLink(
      { linkId, actor: toExternalLinkLifecycleActor(user) },
      { persistence: getExternalLinkLifecyclePersistence() },
    );
    return { error: null };
  } catch (error: unknown) {
    await reportServerError("external_link.deactivate", error);
    return { error: "Unable to update external link right now." };
  }
}

export async function activateExternalLink(linkId: string): Promise<{ error: string | null }> {
  try {
    const user = await requireRole(["super_admin", "venue_admin"]);
    await activateAdminExternalLink(
      { linkId, actor: toExternalLinkLifecycleActor(user) },
      { persistence: getExternalLinkLifecyclePersistence() },
    );
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
): Promise<ApiResponse<ExternalLinkPublicValidationData>> {
  return measureServerOperation("server.external_validate", async (): Promise<ApiResponse<ExternalLinkPublicValidationData>> => {
    try {
      return await validatePublicExternalToken(
        { token, ownerKey },
        getExternalLinkPublicDependencies(),
      );
    } catch (error: unknown) {
      await reportServerError("external_link.validate", error);
      return { data: null, error: "EXTERNAL_LINK_UNAVAILABLE" };
    }
  });
}

export async function createGuestsViaExternalLink(params: {
  token: string;
  date: string;
  items: BulkGuestCreateInput[];
}): Promise<ApiResponse<ExternalLinkPublicGuestCreateResult>> {
  return measureServerOperation("server.external_guest_create", async (): Promise<ApiResponse<ExternalLinkPublicGuestCreateResult>> => {
    try {
      return await createPublicGuestsViaExternalLink(
        params,
        getExternalLinkPublicDependencies(),
      );
    } catch (error: unknown) {
      await reportServerError("external_link.guest_create", error);
      return {
        data: null,
        error: "Unable to register guests right now. Please try again.",
      };
    }
  });
}

/**
 * 외부 DJ 토큰으로 게스트 생성 (인증 불필요 — 토큰 기반 공개 접근).
 * usedGuests 증가는 capability persistence의 원자 UPDATE가 소유한다.
 */
export async function createGuestViaExternalLink(params: {
  token: string;
  guestName: string;
  date: string;
  ownerKey?: string | null;
}): Promise<ApiResponse<ExternalLinkPublicGuest>> {
  try {
    const dependencies = getExternalLinkPublicDependencies();
    const kind = await loadPublicExternalLinkKind(params.token, dependencies);
    if (kind === "self_rsvp") {
      return await createPublicSelfRsvpGuest(
        {
          token: params.token,
          ownerKey: params.ownerKey ?? "",
          guestName: params.guestName,
          date: params.date,
        },
        dependencies,
      );
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
}): Promise<ApiResponse<ExternalLinkPublicGuest>> {
  try {
    return await updatePublicGuestViaExternalLink(
      params,
      getExternalLinkPublicDependencies(),
    );
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
    return await deletePublicGuestViaExternalLink(
      params,
      getExternalLinkPublicDependencies(),
    );
  } catch (error: unknown) {
    await reportServerError("external_link.guest_delete", error);
    return { error: "Unable to delete guest right now. Please try again." };
  }
}
